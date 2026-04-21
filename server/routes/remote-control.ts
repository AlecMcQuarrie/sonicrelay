import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { clients, broadcastToVoiceChannel } from '../clients';

type ControlSession = {
  sessionId: string;
  sharer: string;
  controller: string;
  channelId: string;
  createdAt: number;
};

// One active session per sharer; new grants replace old. Indexed by sharer
// rather than sessionId so revocation on disconnect is a constant-time lookup.
const sessionsBySharer = new Map<string, ControlSession>();
const sessionsById = new Map<string, ControlSession>();

function findSocket(username: string): WebSocket | null {
  for (const [ws, client] of clients) {
    if (client.username === username && ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

function sameVoiceChannel(a: string, b: string): string | null {
  let channelA: string | null = null;
  let channelB: string | null = null;
  for (const client of clients.values()) {
    if (client.username === a) channelA = client.voiceChannelId;
    if (client.username === b) channelB = client.voiceChannelId;
  }
  return channelA && channelB && channelA === channelB ? channelA : null;
}

// Revoke whatever sessions involve this username (as sharer or controller).
// Called on WS close and on explicit revoke. Broadcasts to the voice channel
// so both sides tear down their local state.
export function revokeSessionsFor(username: string) {
  for (const [, session] of sessionsById) {
    if (session.sharer !== username && session.controller !== username) continue;
    sessionsById.delete(session.sessionId);
    sessionsBySharer.delete(session.sharer);
    broadcastToVoiceChannel(session.channelId, {
      type: 'remote-control-notification',
      action: 'control-revoked',
      sessionId: session.sessionId,
      reason: 'disconnect',
    });
  }
}

export async function handleRemoteControlMessage(
  ws: WebSocket,
  username: string,
  msg: any,
) {
  const respond = (data: any) => {
    if (msg.requestId) {
      ws.send(JSON.stringify({ requestId: msg.requestId, ...data }));
    }
  };

  switch (msg.action) {
    case 'request-control': {
      const target = msg.targetUsername;
      if (typeof target !== 'string' || target === username) {
        respond({ error: 'invalid target' });
        return;
      }
      if (!sameVoiceChannel(username, target)) {
        respond({ error: 'not in the same voice channel' });
        return;
      }
      const targetWs = findSocket(target);
      if (!targetWs) {
        respond({ error: 'target offline' });
        return;
      }
      targetWs.send(JSON.stringify({
        type: 'remote-control-notification',
        action: 'control-requested',
        requesterUsername: username,
      }));
      respond({ ok: true });
      return;
    }

    case 'respond-control': {
      const requester = msg.requesterUsername;
      if (typeof requester !== 'string') {
        respond({ error: 'invalid requester' });
        return;
      }
      const requesterWs = findSocket(requester);
      const channelId = sameVoiceChannel(username, requester);

      if (!msg.granted || !requesterWs || !channelId) {
        if (requesterWs) {
          requesterWs.send(JSON.stringify({
            type: 'remote-control-notification',
            action: 'control-denied',
            sharerUsername: username,
          }));
        }
        respond({ ok: true });
        return;
      }

      // Replace any existing session for this sharer
      const prior = sessionsBySharer.get(username);
      if (prior) {
        sessionsById.delete(prior.sessionId);
        broadcastToVoiceChannel(prior.channelId, {
          type: 'remote-control-notification',
          action: 'control-revoked',
          sessionId: prior.sessionId,
          reason: 'superseded',
        });
      }

      const session: ControlSession = {
        sessionId: randomUUID(),
        sharer: username,
        controller: requester,
        channelId,
        createdAt: Date.now(),
      };
      sessionsBySharer.set(username, session);
      sessionsById.set(session.sessionId, session);

      const grantedMsg = JSON.stringify({
        type: 'remote-control-notification',
        action: 'control-granted',
        sessionId: session.sessionId,
        sharerUsername: username,
        controllerUsername: requester,
      });
      requesterWs.send(grantedMsg);
      ws.send(grantedMsg);
      respond({ ok: true });
      return;
    }

    case 'revoke-control': {
      const session = sessionsById.get(msg.sessionId);
      if (!session) { respond({ ok: true }); return; }
      // Either party can revoke their own session.
      if (session.sharer !== username && session.controller !== username) {
        respond({ error: 'not your session' });
        return;
      }
      sessionsById.delete(session.sessionId);
      sessionsBySharer.delete(session.sharer);
      broadcastToVoiceChannel(session.channelId, {
        type: 'remote-control-notification',
        action: 'control-revoked',
        sessionId: session.sessionId,
        reason: typeof msg.reason === 'string' ? msg.reason : 'stopped',
      });
      respond({ ok: true });
      return;
    }

    case 'input': {
      const session = sessionsById.get(msg.sessionId);
      if (!session || session.controller !== username) return; // silently drop
      const sharerWs = findSocket(session.sharer);
      if (!sharerWs) return;
      sharerWs.send(JSON.stringify({
        type: 'remote-control-notification',
        action: 'control-input',
        sessionId: session.sessionId,
        event: msg.event,
      }));
      return;
    }
  }
}
