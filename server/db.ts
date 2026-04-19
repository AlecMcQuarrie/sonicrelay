import { Database } from "simpl.db";

const db = new Database();

export type VoicePeerSetting = {
  volume: number;
  muted: boolean;
};

export type Role = 'superadmin' | 'admin' | 'member';

export type CustomThemeColors = {
  background: string;
  card: string;
  foreground: string;
  primary: string;
  destructive: string;
};

export type UserSettings = {
  micGain?: number;
  speakerGain?: number;
  vadMode?: 'off' | 'auto' | 'manual';
  vadThreshold?: number;
  pttEnabled?: boolean;
  pttKey?: string;
  normalizeVoices?: boolean;
  theme?: string;
  customThemeColors?: CustomThemeColors;
};

export type User = {
  username: string;
  password: string;
  profilePhoto: string | null;
  voicePeerSettings: Record<string, VoicePeerSetting> | null;
  screenAudioPeerSettings: Record<string, VoicePeerSetting> | null;
  role: Role;
  banned: boolean;
  nameColor: string | null;
  settings: UserSettings | null;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  pbkdfSalt: string | null;
  $id: string;
};
export const Users = db.createCollection<User>("users");

export type Channel = {
  name: string;
  type: "text" | "voice";
  $id: string;
};
export const Channels = db.createCollection<Channel>("channels");

export type Message = {
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
  attachments: string[];
  replyToId: string | null;
  $id: string;
};
export const Messages = db.createCollection<Message>("messages");

export type DirectMessage = {
  conversationId: string;
  sender: string;
  iv: string;
  ciphertext: string;
  timestamp: string;
  attachments: string[];
  replyToId: string | null;
  $id: string;
};
export const DirectMessages = db.createCollection<DirectMessage>("direct_messages");

export type DmConversation = {
  username: string;
  partner: string;
  lastTimestamp: string;
  $id: string;
};
export const DmConversations = db.createCollection<DmConversation>("dm_conversations");

export function upsertDmConversation(user: string, partner: string, timestamp: string) {
  const existing = DmConversations.get(
    (c: any) => c.username === user && c.partner === partner
  );
  if (existing) {
    DmConversations.update(
      (c) => { c.lastTimestamp = timestamp; },
      (c: any) => c.username === user && c.partner === partner,
    );
  } else {
    DmConversations.create({ username: user, partner, lastTimestamp: timestamp });
  }
}

export type LastRead = {
  username: string;
  targetId: string;
  timestamp: string;
  $id: string;
};
export const LastReads = db.createCollection<LastRead>("last_reads");

export function upsertLastRead(username: string, targetId: string, timestamp: string) {
  const existing = LastReads.get(
    (r: any) => r.username === username && r.targetId === targetId
  );
  if (existing) {
    LastReads.update(
      (r) => { r.timestamp = timestamp; },
      (r: any) => r.username === username && r.targetId === targetId,
    );
  } else {
    LastReads.create({ username, targetId, timestamp });
  }
}

// Seed default channels if none exist
if (Channels.getAll().length === 0) {
  Channels.create({ name: "general", type: "text" });
  Channels.create({ name: "General", type: "voice" });
}
