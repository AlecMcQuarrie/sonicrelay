# SonicRelay

A decentralized Discord alternative built from scratch. Text channels, voice channels, screen sharing — fully self-hosted and community-owned.

Anyone can download a packaged server and client, spin up their own instance, and use it with their own friend group. No central authority, no data collection, no Terms of Service changes — just you and your people on your own hardware.

## Philosophy

- **Small and simple.** Every component, every function, every file should be as small and purpose-built as possible. No abstractions until they're needed. Three lines of repeated code is better than a premature helper.
- **Human readable.** Code should read like a description of what it does. Anyone should be able to open a file and understand it immediately.
- **Minimal dependencies.** Only add a library when building it yourself would be unreasonable. mediasoup handles WebRTC because that's a massive protocol. But we don't need a state management library when `useState` works fine.
- **Robust and maintainable.** Optimized code that can be easily maintained in the future. No over-engineering, no clever tricks.

## Architecture

```
SonicRelay/
├── client/          # React frontend (Vite + React Router)
└── server/          # Express.js backend (single process)
```

### Server

Single Node.js process running Express (REST API), WebSocket (real-time chat + voice signaling), and mediasoup (voice/video/screenshare). Everything runs on one port.

- **REST endpoints**: Auth (signup/login), channels, messages
- **WebSocket**: Text chat broadcasting, voice signaling (request/response pattern using `requestId`)
- **mediasoup**: SFU (Selective Forwarding Unit) for voice — every client connects to the server, no peer-to-peer NAT issues

WebSocket messages use a `type` field to distinguish between `text-message`, `voice` (signaling requests), `voice-notification` (server pushes), and `voice-state` (initial state on connect).

### Client

React Router app. Each component has one job:

- `ServerJoin` — login/signup form
- `Server` — layout container, owns WebSocket + VoiceClient
- `ChannelSidebar` — lists text and voice channels
- `TextChannel` — message display + input for one channel
- `VoiceControls` — mute/disconnect when in voice

Voice client logic lives in `lib/voice.ts` as a `VoiceClient` class that wraps mediasoup-client.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend framework | React 19 + React Router v7 |
| Frontend build | Vite |
| UI components | shadcn/ui (Radix primitives + Tailwind CSS) |
| Icons | lucide-react |
| Backend framework | Express.js 5 |
| WebSocket | ws |
| Voice/Video | mediasoup (server) + mediasoup-client (client) |
| Database | simpl.db (JSON file-based) |
| Auth | bcrypt (password hashing) + JWT (tokens) |
| Language | TypeScript (both client and server) |

## Database (simpl.db) Quirks

simpl.db is a lightweight JSON-based database. Important things to know:

- **ID field**: simpl.db uses `__id` as the auto-generated ID field everywhere at runtime — in filter callbacks, in `getAll()` results, in JSON serialization, and in API responses. The TypeScript types declare `$id` but it does not work in practice. Always use `__id` (cast with `as any` if needed to satisfy TypeScript).
- **Collection files** live in `server/collections/` as plain JSON arrays.
- **No migrations** — if you change a schema, you may need to delete the collection JSON file and let it re-seed.

## Running

```bash
# Server (from /server)
npm install
npm start          # runs via ts-node

# Client (from /client)
npm install
npm run dev        # Vite dev server on :5173
```

Server runs on port 3000 by default. Client proxies to it. The Server IP field in the login form should be `localhost:3000` for local development.

## Environment Variables (server/.env)

- `PORT` — server port (default 3000)
- `ENCRYPTION_KEY` — JWT signing secret
- `SALT` — bcrypt salt rounds
- `ANNOUNCED_IP` — mediasoup's public IP for WebRTC (use `127.0.0.1` for local dev, your public IP for production)
- `ALLOWED_ORIGINS` — optional comma-separated CORS allowlist (e.g. `http://localhost:5173,https://chat.example.com`). When unset, any origin is reflected (safe because auth is header-based, not cookies).
