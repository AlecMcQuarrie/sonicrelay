import { WebSocket } from 'ws';

export type ConnectedClient = {
  username: string;
  voiceChannelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
};

export const clients = new Map<WebSocket, ConnectedClient>();

export function getVoicePeers(): Record<string, string[]> {
  const peers: Record<string, string[]> = {};
  for (const client of clients.values()) {
    if (client.voiceChannelId) {
      if (!peers[client.voiceChannelId]) peers[client.voiceChannelId] = [];
      peers[client.voiceChannelId].push(client.username);
    }
  }
  return peers;
}

export function getMutedUsers(): string[] {
  const muted: string[] = [];
  for (const client of clients.values()) {
    if (client.voiceChannelId && client.isMuted) {
      muted.push(client.username);
    }
  }
  return muted;
}

export function getDeafenedUsers(): string[] {
  const deafened: string[] = [];
  for (const client of clients.values()) {
    if (client.voiceChannelId && client.isDeafened) {
      deafened.push(client.username);
    }
  }
  return deafened;
}

export function getOnlineUsernames(): string[] {
  const names = new Set<string>();
  for (const client of clients.values()) {
    names.add(client.username);
  }
  return [...names];
}

export function broadcastPresence() {
  broadcastToAll({ type: 'presence', onlineUsers: getOnlineUsernames() });
}

export function broadcastUserKey(username: string, publicKey: string) {
  broadcastToAll({ type: 'user-key', username, publicKey });
}

export function broadcastToAll(message: object) {
  const data = JSON.stringify(message);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

export function broadcastToVoiceChannel(channelId: string, message: object, excludeWs?: WebSocket) {
  const data = JSON.stringify(message);
  for (const [ws, client] of clients) {
    if (client.voiceChannelId === channelId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
