const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

import express, { Request, Response } from "express";
import { Database } from "simpl.db";
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import "dotenv/config";
import * as voice from './voice';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

type RipV2IncomingMessage = IncomingMessage & {
  username?: string;
}

const app = express();
const port = process.env.PORT || 3000;

const db = new Database();

type VoicePeerSetting = {
  volume: number;
  muted: boolean;
};

type User = {
  username: string;
  password: string;
  profilePhoto: string | null;
  voicePeerSettings: Record<string, VoicePeerSetting> | null;
  $id: string;
};
const Users = db.createCollection<User>("users");

type Channel = {
  name: string;
  type: "text" | "voice";
  $id: string;
};
const Channels = db.createCollection<Channel>("channels");

type Message = {
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
  attachments: string[];
  $id: string;
};
const Messages = db.createCollection<Message>("messages");

// Seed default channels if none exist
if (Channels.getAll().length === 0) {
  Channels.create({ name: "general", type: "text" });
  Channels.create({ name: "General", type: "voice" });
}

const cors = require('cors');
app.use(cors({ origin: true }));

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// parse application/json
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// File upload via multer
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Server start
const server = app.listen(port, async () => {
  await voice.init();
  console.log(`RipV2 server started at http://localhost:${port}`);
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  return res.send("RipV2 server running");
});

app.post("/signup", async (req: Request, res: Response) => {
  // If username already exists
  if (Users.get((x) => x.username === req.body.username)) {
    return res.sendStatus(500);
  }

  // Create user and hash password
  const password = await bcrypt.hash(req.body.password, +(process.env.SALT || 12));

  const user = {
    username: req.body.username,
    password: password,
    profilePhoto: null,
    voicePeerSettings: null,
  };
  Users.create(user);

  const token = jwt.sign(
    { username: user.username },
    process.env.ENCRYPTION_KEY,
  );
  return res.status(200).json({ accessToken: token });
});

app.post("/login", async (req: Request, res: Response) => {
  const user = Users.get((x) => x.username === req.body.username);
  // If username already exists
  if (!user) {
    return res.sendStatus(404);
  }

  // Create user and hash password
  const compare = await bcrypt.compare(req.body.password, user.password);

  if (compare) {
    const token = jwt.sign(
      { username: user.username },
      process.env.ENCRYPTION_KEY,
    );
    return res.status(200).json({ accessToken: token });
  }

  // Send 200 if successful
  return res.sendStatus(401);
});

app.post("/me", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    const user = Users.get((u) => u.username === username);
    return res.status(200).json({ username, profilePhoto: user?.profilePhoto || null });
  }
  return res.sendStatus(401);
});

app.put("/me/profile-photo", upload.single('file'), (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"] as string;
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (!username) return res.sendStatus(401);
  const file = req.file as Express.Multer.File;
  if (!file) return res.sendStatus(400);
  const url = `/uploads/${file.filename}`;
  Users.update((u) => { u.profilePhoto = url; }, (u) => u.username === username);
  return res.status(200).json({ profilePhoto: url });
});

// Voice peer settings endpoints
app.get("/me/voice-peer-settings", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (!username) return res.sendStatus(401);
  const user = Users.get((u) => u.username === username);
  return res.status(200).json({ voicePeerSettings: user?.voicePeerSettings || {} });
});

app.put("/me/voice-peer-settings", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"] as string;
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (!username) return res.sendStatus(401);
  const { peerUsername, volume, muted } = req.body;
  if (!peerUsername) return res.sendStatus(400);
  const user = Users.get((u) => u.username === username);
  if (!user) return res.sendStatus(404);
  const settings = (user as any).voicePeerSettings || {};
  settings[peerUsername] = { volume: volume ?? 1, muted: muted ?? false };
  Users.update((u) => { (u as any).voicePeerSettings = settings; }, (u) => u.username === username);
  return res.status(200).json({ voicePeerSettings: settings });
});

// Channel endpoints
app.get("/channels", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    return res.status(200).json({ channels: Channels.getAll() });
  }
  return res.sendStatus(401);
});

app.post("/channels", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    const channel = Channels.create({ name: req.body.name, type: req.body.type || "text" });
    return res.status(200).json({ channel });
  }
  return res.sendStatus(401);
});

// Users endpoint
app.get("/users", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    const users = Users.getAll().map((u) => ({ username: u.username, profilePhoto: u.profilePhoto || null }));
    return res.status(200).json({ users });
  }
  return res.sendStatus(401);
});

// Upload endpoint
app.post("/upload", upload.array('files', 10), (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"] as string;
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (!username) return res.sendStatus(401);
  const files = req.files as Express.Multer.File[];
  const urls = files.map((f) => `/uploads/${f.filename}`);
  return res.status(200).json({ urls });
});

// Message endpoint
app.get("/channels/:channelId/messages", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    const messages = Messages.getAll().filter(
      (m) => m.channelId === req.params.channelId,
    );
    return res.status(200).json({ messages });
  }
  return res.sendStatus(401);
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

// Track connected clients
type ConnectedClient = {
  username: string;
  voiceChannelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
};
const clients = new Map<WebSocket, ConnectedClient>();

// Get current voice peers across all channels
function getVoicePeers(): Record<string, string[]> {
  const peers: Record<string, string[]> = {};
  for (const client of clients.values()) {
    if (client.voiceChannelId) {
      if (!peers[client.voiceChannelId]) peers[client.voiceChannelId] = [];
      peers[client.voiceChannelId].push(client.username);
    }
  }
  return peers;
}

// Get self-muted usernames across all voice channels
function getMutedUsers(): string[] {
  const muted: string[] = [];
  for (const client of clients.values()) {
    if (client.voiceChannelId && client.isMuted) {
      muted.push(client.username);
    }
  }
  return muted;
}

// Get self-deafened usernames across all voice channels
function getDeafenedUsers(): string[] {
  const deafened: string[] = [];
  for (const client of clients.values()) {
    if (client.voiceChannelId && client.isDeafened) {
      deafened.push(client.username);
    }
  }
  return deafened;
}

// Get unique online usernames
function getOnlineUsernames(): string[] {
  const names = new Set<string>();
  for (const client of clients.values()) {
    names.add(client.username);
  }
  return [...names];
}

// Broadcast current online users to all clients
function broadcastPresence() {
  broadcastToAll({ type: 'presence', onlineUsers: getOnlineUsernames() });
}

// Broadcast to all connected clients
function broadcastToAll(message: object) {
  const data = JSON.stringify(message);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// Broadcast to peers in a specific voice channel (excluding one client)
function broadcastToVoiceChannel(channelId: string, message: object, excludeWs?: WebSocket) {
  const data = JSON.stringify(message);
  for (const [ws, client] of clients) {
    if (client.voiceChannelId === channelId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// WebSocket server with JWT auth
const wss = new WebSocketServer({
  server, verifyClient: (info: { req: RipV2IncomingMessage }, authenticate) => {
    const url = new URL(info.req.url || "", `http://${info.req.headers.host}`);
    const accessToken = info.req.headers["access-token"] || url.searchParams.get("token");
    const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
    if (username) {
      info.req.username = username;
      authenticate(true);
      return;
    }
    authenticate(false, 401);
    return;
  }
});

// Ping measurement: track round-trip time per client
const clientPings = new Map<WebSocket, number>(); // ws -> latency in ms

// Build a username -> ping map for all voice-connected users
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
  for (const [ws, client] of clients) {
    if ((ws as any).isAlive === false) {
      ws.terminate();
      continue;
    }
    (ws as any).isAlive = false;
    (ws as any).pingSentAt = Date.now();
    ws.ping();
  }

  // Broadcast current pings to everyone in voice
  const pings = getVoicePings();
  if (Object.keys(pings).length > 0) {
    broadcastToAll({ type: 'voice-pings', pings });
  }
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws, req: RipV2IncomingMessage) => {
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
    const msg = JSON.parse(data.toString());

    // ── Text message ──
    if (msg.type === 'text-message') {
      const attachments: string[] = msg.attachments || [];
      const timestamp = new Date().toISOString();
      const stored = Messages.create({
        channelId: msg.channelId,
        messageContent: msg.messageContent,
        attachments,
        timestamp,
        sender: username,
      });
      const message = {
        type: 'text-message',
        __id: stored.$id,
        channelId: msg.channelId,
        messageContent: msg.messageContent,
        attachments,
        timestamp,
        sender: username,
      };
      // Echo back to sender so they get the __id
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
      if (!message || message.sender !== username) return;
      // Delete attachment files from disk
      for (const url of message.attachments || []) {
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
            if (client) client.voiceChannelId = null;
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
