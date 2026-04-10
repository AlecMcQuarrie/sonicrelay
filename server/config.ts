import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ServerConfig = {
  serverId: string;
  serverName: string;
};

const CONFIG_PATH = path.join(__dirname, 'server-config.json');

let cached: ServerConfig | null = null;

export function loadServerConfig(): ServerConfig {
  if (cached) return cached;

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    cached = JSON.parse(raw);
    return cached!;
  }

  const fresh: ServerConfig = {
    serverId: crypto.randomUUID(),
    serverName: process.env.SERVER_NAME || 'Ripcord Server',
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(fresh, null, 2));
  cached = fresh;
  return fresh;
}
