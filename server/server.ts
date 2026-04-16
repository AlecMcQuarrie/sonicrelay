import express from "express";
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import "dotenv/config";
import path from 'path';
import fs from 'fs';
import * as voice from './voice';
import { Users, Messages, DirectMessages, Channels, upsertDmConversation } from './db';
import { clients, broadcastToAll, broadcastToVoiceChannel, broadcastPresence, broadcastUserKey, getVoicePeers, getMutedUsers, getDeafenedUsers } from './clients';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import userRoutes from './routes/users';
import dmRoutes from './routes/dm';
import uploadRoutes from './routes/uploads';
import readStatusRoutes from './routes/read-status';
import serverInfoRoutes from './routes/server-info';
import { loadServerConfig } from './config';

const jwt = require("jsonwebtoken");
const cors = require('cors');

type SonicRelayIncomingMessage = IncomingMessage & {
  username?: string;
};

// Fail fast if the JWT secret is missing or weak — otherwise the bug only
// surfaces at first sign/verify op and can leave a server running with a
// trivially-forgeable token.
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
  console.error('FATAL: ENCRYPTION_KEY env var must be set and at least 32 characters');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

// Reject attachment URLs that escape the uploads directory. Used both at
// storage time (to keep bad data out of the DB) and at unlink time (defense
// in depth against any bad data already stored).
const uploadsDir = path.resolve(path.join(__dirname, 'uploads'));
function isSafeUploadUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const resolved = path.resolve(path.join(__dirname, url));
  return resolved === uploadsDir || resolved.startsWith(uploadsDir + path.sep);
}

// Middleware
// ALLOWED_ORIGINS is a comma-separated allowlist. When unset, we reflect any
// origin — fine for this app because auth is header-based (no cookies), so a
// malicious page can't piggyback on a user's session without the token.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// NOTE: uploaded files are served by the authenticated GET /uploads/:filename
// route in routes/uploads.ts — do not mount express.static here.

// Health check
app.get("/health", (_req, res) => res.send("SonicRelay server running"));

// Routes
app.use(serverInfoRoutes);
app.use(authRoutes);
app.use(channelRoutes);
app.use(userRoutes);
app.use(dmRoutes);
app.use(uploadRoutes);
app.use(readStatusRoutes);

// Server start
const config = loadServerConfig();
const server = app.listen(port, async () => {
  await voice.init();
  console.log(`SonicRelay server "${config.serverName}" (${config.serverId}) started at http://localhost:${port}`);
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server, verifyClient: (info: { req: SonicRelayIncomingMessage }, authenticate) => {
    try {
      const url = new URL(info.req.url || "", `http://${info.req.headers.host}`);
      const accessToken = info.req.headers["access-token"] || url.searchParams.get("token");
      const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
      if (username) {
        const user = Users.get((u) => u.username === username);
        if (!user || user.banned) {
          authenticate(false, 403);
          return;
        }
        info.req.username = username;
        authenticate(true);
        return;
      }
    } catch (err) {
      console.warn('WebSocket auth failed:', (err as Error).message);
    }
    authenticate(false, 401);
  }
});

// Ping measurement: track round-trip time per client
const clientPings = new Map<WebSocket, number>();

// Tear down any live voice sessions belonging to the same user on other
// sockets before a new join. Prevents duplicate mediasoup peers (and the
// resulting chorus effect) when the same account joins from a second tab.
function evictPriorVoiceSessions(username: string, currentWs: WebSocket) {
  for (const [otherWs, otherClient] of clients) {
    if (otherWs === currentWs) continue;
    if (otherClient.username !== username) continue;
    if (!otherClient.voiceChannelId) continue;

    const oldChannelId = otherClient.voiceChannelId;
    const closedProducerIds = voice.leave(oldChannelId, username);
    otherClient.voiceChannelId = null;
    otherClient.isMuted = false;
    otherClient.isDeafened = false;

    for (const producerId of closedProducerIds) {
      broadcastToVoiceChannel(oldChannelId, {
        type: 'voice-notification', action: 'producer-closed', producerId,
      });
    }
    broadcastToAll({
      type: 'voice-notification', action: 'peer-left',
      channelId: oldChannelId, username,
    });
    if (otherWs.readyState === WebSocket.OPEN) {
      otherWs.send(JSON.stringify({
        type: 'voice-notification', action: 'session-superseded',
        channelId: oldChannelId,
      }));
    }
  }
}

function getVoicePings(): Record<string, number> {
  const pings: Record<string, number> = {};
  for (const [ws, client] of clients) {
    if (client.voiceChannelId) {
      const ping = clientPings.get(ws);
      if (ping !== undefined) pings[client.username] = ping;
    }
  }
  return pings;
}

// Ping all clients every 5 seconds, measure latency, broadcast to voice peers
const PING_INTERVAL = 5000;
const pingInterval = setInterval(() => {
  for (const [ws] of clients) {
    if ((ws as any).isAlive === false) {
      ws.terminate();
      continue;
    }
    (ws as any).isAlive = false;
    (ws as any).pingSentAt = Date.now();
    ws.ping();
  }

  const pings = getVoicePings();
  if (Object.keys(pings).length > 0) {
    broadcastToAll({ type: 'voice-pings', pings });
  }
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws, req: SonicRelayIncomingMessage) => {
  const username = req.username!;
  (ws as any).isAlive = true;
  ws.on('pong', () => {
    (ws as any).isAlive = true;
    if ((ws as any).pingSentAt) {
      clientPings.set(ws, Date.now() - (ws as any).pingSentAt);
    }
  });
  clients.set(ws, { username, voiceChannelId: null, isMuted: false, isDeafened: false });

  // Send current voice state on connect
  ws.send(JSON.stringify({ type: 'voice-state', voicePeers: getVoicePeers(), mutedUsers: getMutedUsers(), deafenedUsers: getDeafenedUsers() }));

  // Notify all clients of updated online users
  broadcastPresence();

  // Push this user's public key so already-online clients can DM them immediately
  const userRecord = Users.get((u) => u.username === username);
  const pubKey = (userRecord as any)?.publicKey;
  if (pubKey) broadcastUserKey(username, pubKey);

  // Clean up on disconnect
  ws.on('close', () => {
    const client = clients.get(ws);
    if (client?.voiceChannelId) {
      const closedProducerIds = voice.leave(client.voiceChannelId, username);
      for (const producerId of closedProducerIds) {
        broadcastToVoiceChannel(client.voiceChannelId, {
          type: 'voice-notification', action: 'producer-closed', producerId,
        });
      }
      broadcastToAll({
        type: 'voice-notification', action: 'peer-left',
        channelId: client.voiceChannelId, username,
      });
    }
    clients.delete(ws);
    clientPings.delete(ws);
    broadcastPresence();
  });

  // Handle incoming messages
  ws.on('message', async (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.warn('Malformed WebSocket message from', username, (err as Error).message);
      return;
    }

    // ── Text message ──
    if (msg.type === 'text-message') {
      if (typeof msg.channelId !== 'string') return;
      if (typeof msg.messageContent !== 'string') return;
      if (msg.messageContent.length > 4000) return;
      const channel = Channels.get((c: any) => c.__id === msg.channelId);
      if (!channel || channel.type !== 'text') return;
      const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments.slice(0, 10) : [];
      const attachments: string[] = rawAttachments.filter(isSafeUploadUrl);
      const timestamp = new Date().toISOString();
      const replyToId = typeof msg.replyToId === 'string' ? msg.replyToId : null;
      const stored = Messages.create({
        channelId: msg.channelId,
        messageContent: msg.messageContent,
        attachments,
        timestamp,
        sender: username,
        replyToId,
      });
      const message = {
        type: 'text-message',
        __id: (stored as any).__id,
        channelId: msg.channelId,
        messageContent: msg.messageContent,
        attachments,
        timestamp,
        sender: username,
        replyToId,
      };
      ws.send(JSON.stringify(message));
      for (const [client] of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      }
      return;
    }

    // ── Delete message ──
    if (msg.type === 'delete-message') {
      const message = Messages.get((m: any) => m.__id === msg.messageId);
      const actor = Users.get((u) => u.username === username);
      const isAdmin = actor?.role === 'admin' || actor?.role === 'superadmin';
      if (!message || (message.sender !== username && !isAdmin)) return;
      for (const url of message.attachments || []) {
        if (!isSafeUploadUrl(url)) continue;
        const filePath = path.join(__dirname, url);
        fs.unlink(filePath, () => {});
      }
      Messages.remove((m: any) => m.__id === msg.messageId);
      for (const [client] of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'delete-message', messageId: msg.messageId }));
        }
      }
      return;
    }

    // ── Direct message (E2E encrypted) ──
    if (msg.type === 'dm-message') {
      if (!msg.recipient || typeof msg.recipient !== 'string') return;
      if (!msg.iv || typeof msg.iv !== 'string') return;
      if (!msg.ciphertext || typeof msg.ciphertext !== 'string') return;
      if (msg.iv.length > 100 || msg.ciphertext.length > 100_000) return;
      if (msg.recipient === username) return;

      const recipient = Users.get((u) => u.username === msg.recipient);
      if (!recipient || recipient.banned) return;

      // DM attachments are JSON strings of shape {url, iv, name}. Validate
      // the parsed url stays within the uploads dir; drop anything malformed.
      const rawAttachments: unknown[] = Array.isArray(msg.attachments) ? msg.attachments.slice(0, 10) : [];
      const attachments: string[] = [];
      for (const a of rawAttachments) {
        if (typeof a !== 'string') continue;
        try {
          const parsed = JSON.parse(a);
          if (isSafeUploadUrl(parsed?.url)) attachments.push(a);
        } catch { /* drop */ }
      }
      const replyToId = typeof msg.replyToId === 'string' ? msg.replyToId : null;

      const conversationId = [username, msg.recipient].sort().join(':');
      const timestamp = new Date().toISOString();
      const stored = DirectMessages.create({
        conversationId,
        sender: username,
        iv: msg.iv,
        ciphertext: msg.ciphertext,
        timestamp,
        attachments,
        replyToId,
      });
      upsertDmConversation(username, msg.recipient, timestamp);
      upsertDmConversation(msg.recipient, username, timestamp);
      const outgoing = {
        type: 'dm-message',
        __id: (stored as any).__id,
        conversationId,
        sender: username,
        recipient: msg.recipient,
        iv: msg.iv,
        ciphertext: msg.ciphertext,
        timestamp,
        attachments,
        replyToId,
      };
      ws.send(JSON.stringify(outgoing));
      for (const [clientWs, client] of clients) {
        if (client.username === msg.recipient && clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(outgoing));
        }
      }
      return;
    }

    // ── Delete direct message ──
    if (msg.type === 'dm-delete-message') {
      const dm = DirectMessages.get((m: any) => m.__id === msg.messageId);
      if (!dm || dm.sender !== username) return;
      for (const att of dm.attachments || []) {
        let url: unknown = att;
        try { url = JSON.parse(att).url; } catch {}
        if (!isSafeUploadUrl(url)) continue;
        const filePath = path.join(__dirname, url);
        fs.unlink(filePath, () => {});
      }
      DirectMessages.remove((m: any) => m.__id === msg.messageId);
      const parts = dm.conversationId.split(':');
      const partner = parts[0] === username ? parts[1] : parts[0];
      const deletion = JSON.stringify({ type: 'dm-delete-message', messageId: msg.messageId });
      ws.send(deletion);
      for (const [clientWs, client] of clients) {
        if (client.username === partner && clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(deletion);
        }
      }
      return;
    }

    // ── Mute state ──
    if (msg.type === 'mute-state') {
      const client = clients.get(ws);
      if (client) {
        client.isMuted = msg.muted;
        broadcastToAll({ type: 'mute-state', username, muted: msg.muted });
      }
      return;
    }

    // ── Deafen state ──
    if (msg.type === 'deafen-state') {
      const client = clients.get(ws);
      if (client) {
        client.isDeafened = msg.deafened;
        broadcastToAll({ type: 'deafen-state', username, deafened: msg.deafened });
      }
      return;
    }

    // ── Voice signaling ──
    if (msg.type === 'voice') {
      const respond = (responseData: any) => {
        ws.send(JSON.stringify({ requestId: msg.requestId, ...responseData }));
      };

      try {
        switch (msg.action) {
          case 'join': {
            evictPriorVoiceSessions(username, ws);
            const result = await voice.join(msg.channelId, username);
            const client = clients.get(ws);
            if (client) client.voiceChannelId = msg.channelId;
            respond(result);
            broadcastToAll({
              type: 'voice-notification', action: 'peer-joined',
              channelId: msg.channelId, username,
            });
            break;
          }
          case 'create-transport': {
            const result = await voice.createTransport(msg.channelId, username, msg.direction);
            respond(result);
            break;
          }
          case 'connect-transport': {
            await voice.connectTransport(msg.channelId, username, msg.transportId, msg.dtlsParameters);
            respond({});
            break;
          }
          case 'produce': {
            const result = await voice.produce(msg.channelId, username, msg.kind, msg.rtpParameters, msg.source);
            respond(result);
            broadcastToVoiceChannel(msg.channelId, {
              type: 'voice-notification', action: 'new-producer',
              producerId: result.producerId, kind: msg.kind, username, source: msg.source,
            }, ws);
            break;
          }
          case 'consume': {
            const result = await voice.consume(
              msg.channelId, username, msg.producerId, msg.rtpCapabilities,
            );
            respond(result);
            break;
          }
          case 'close-producer': {
            voice.closeProducer(msg.channelId, username, msg.producerId);
            respond({});
            broadcastToVoiceChannel(msg.channelId, {
              type: 'voice-notification', action: 'producer-closed',
              producerId: msg.producerId,
            }, ws);
            break;
          }
          case 'leave': {
            const closedProducerIds = voice.leave(msg.channelId, username);
            const client = clients.get(ws);
            if (client) {
              client.voiceChannelId = null;
              client.isMuted = false;
              client.isDeafened = false;
            }
            for (const producerId of closedProducerIds) {
              broadcastToVoiceChannel(msg.channelId, {
                type: 'voice-notification', action: 'producer-closed', producerId,
              });
            }
            respond({});
            broadcastToAll({
              type: 'voice-notification', action: 'peer-left',
              channelId: msg.channelId, username,
            });
            break;
          }
        }
      } catch (err: any) {
        respond({ error: err.message });
      }
    }
  });
});
