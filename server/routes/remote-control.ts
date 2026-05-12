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

// Outstanding requests, keyed by sharer → requester → expire timer. Only one
// in-flight request per (sharer, requester) pair: spamming the button while a
// prior request is still unanswered is rejected. The 60s timer auto-clears
// stale entries so an ignored request doesn't lock the requester out forever.
const REQUEST_TTL_MS = 60_000;
const pendingRequests = new Map<string, Map<string, NodeJS.Timeout>>();

// Per-user "remote control allowed" state, set by sharers via `set-rc-state`.
// Absence is treated as false (no share active → no control possible). When a
// sharer flips this, the server broadcasts to their voice channel so
// controllers' UI can disable the Request Control button immediately.
const rcEnabledByUser = new Map<string, boolean>();

function voiceChannelOf(username: string): string | null {
  for (const client of clients.values()) {
    if (client.username === username) return client.voiceChannelId;
  }
  return null;
}

// Called when a peer joins a voice channel — sends them the current
// "remote control enabled" state of every sharer already in that channel,
// so their UI starts in sync without waiting for a state-change broadcast.
export function sendRcStateSnapshot(ws: WebSocket, channelId: string) {
  for (const client of clients.values()) {
    if (client.voiceChannelId !== channelId) continue;
    if (rcEnabledByUser.get(client.username) !== true) continue;
    ws.send(JSON.stringify({
      type: 'remote-control-notification',
      action: 'rc-state-update',
      sharerUsername: client.username,
      enabled: true,
    }));
  }
}

function clearPending(sharer: string, requester: string) {
  const forSharer = pendingRequests.get(sharer);
  if (!forSharer) return;
  const timer = forSharer.get(requester);
  if (timer) clearTimeout(timer);
  forSharer.delete(requester);
  if (forSharer.size === 0) pendingRequests.delete(sharer);
}

function clearPendingFor(username: string) {
  pendingRequests.get(username)?.forEach((timer) => clearTimeout(timer));
  pendingRequests.delete(username);
  for (const [sharer, requesters] of pendingRequests) {
    const timer = requesters.get(username);
    if (!timer) continue;
    clearTimeout(timer);
    requesters.delete(username);
    if (requesters.size === 0) pendingRequests.delete(sharer);
  }
}

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
  clearPendingFor(username);
  // Disconnected users can't still be sharing — broadcast that their RC is
  // off so any controllers in the channel update their buttons.
  if (rcEnabledByUser.get(username)) {
    rcEnabledByUser.delete(username);
    const channelId = voiceChannelOf(username);
    if (channelId) {
      broadcastToVoiceChannel(channelId, {
        type: 'remote-control-notification',
        action: 'rc-state-update',
        sharerUsername: username,
        enabled: false,
      });
    }
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
      if (rcEnabledByUser.get(target) !== true) {
        respond({ error: `${target} has disabled remote control for this share.` });
        return;
      }
      const targetWs = findSocket(target);
      if (!targetWs) {
        respond({ error: 'target offline' });
        return;
      }
      const pendingForTarget = pendingRequests.get(target) ?? new Map<string, NodeJS.Timeout>();
      if (pendingForTarget.has(username)) {
        respond({ error: 'You already have a request pending — wait for a response.' });
        return;
      }
      pendingForTarget.set(
        username,
        setTimeout(() => clearPending(target, username), REQUEST_TTL_MS),
      );
      pendingRequests.set(target, pendingForTarget);

      targetWs.send(JSON.stringify({
        type: 'remote-control-notification',
        action: 'control-requested',
        requesterUsername: username,
      }));
      respond({ ok: true });
      return;
    }

    case 'set-rc-state': {
      // Sharer is publishing whether requests are allowed for their share.
      // Broadcast to their voice channel so peers' UI can update; if no
      // change, skip the broadcast.
      const enabled = !!msg.enabled;
      const prior = rcEnabledByUser.get(username);
      if (prior === enabled) return;
      if (enabled) rcEnabledByUser.set(username, true);
      else rcEnabledByUser.delete(username);
      const channelId = voiceChannelOf(username);
      if (channelId) {
        broadcastToVoiceChannel(channelId, {
          type: 'remote-control-notification',
          action: 'rc-state-update',
          sharerUsername: username,
          enabled,
        });
      }
      return;
    }

    case 'respond-control': {
      const requester = msg.requesterUsername;
      if (typeof requester !== 'string') {
        respond({ error: 'invalid requester' });
        return;
      }
      // Request is being answered — drop the dedup entry so the requester can
      // try again later (if they were denied, or if the granted session ends).
      clearPending(username, requester);
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

    case 'pause-state': {
      // Sharer notifies the controller that their takeover safeguard has
      // paused or resumed injection. Session stays alive either way.
      const session = sessionsById.get(msg.sessionId);
      if (!session || session.sharer !== username) return; // sharer-only
      const controllerWs = findSocket(session.controller);
      if (!controllerWs) return;
      controllerWs.send(JSON.stringify({
        type: 'remote-control-notification',
        action: 'pause-state',
        sessionId: session.sessionId,
        paused: !!msg.paused,
      }));
      return;
    }
  }
}
