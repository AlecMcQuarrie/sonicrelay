# SonicRelay

Highly secure, robust, and open source chat software designed to be self-hosted and used with friends for the purpose of decentralized communication.

Text chat, voice calls, webcams, and screen sharing — all running on hardware you control.

---

## Self-host SonicRelay

SonicRelay has two parts — the **server** (backend) and the **client** (web UI). You run both on one machine. Your friends connect through their browsers.

### Prerequisites

- A Linux, macOS, or Windows machine with Node.js 22 or newer
- A public IP address (home connection or VPS)
- Ability to forward ports on your router (skip this on a VPS)

### 1. Clone the repo

```bash
git clone https://github.com/AlecMcQuarrie/sonicrelay.git
cd sonicrelay
```

### 2. Start the server

Install dependencies and start the backend. It listens on port 3000.

```bash
cd server
npm install
npm start
```

### 3. Start the client

In a second terminal, build the web UI and serve it on port 3001.

```bash
cd client
npm install
npm run build
PORT=3001 npm start
```

### 4. Open the ports

On your router (or VPS firewall), allow inbound traffic on the following ports to the machine running SonicRelay:

| Port         | Protocol | For                          |
| ------------ | -------- | ---------------------------- |
| 80, 443      | TCP      | nginx — HTTPS                |
| 10000–10100  | UDP      | Voice & video (WebRTC)       |

Ports 3000 and 3001 stay local — nginx (step 5) reverse-proxies them to HTTPS.

### 5. Enable HTTPS

SonicRelay requires HTTPS. Browsers block microphone, camera, and screen sharing on plain HTTP, and passwords sent over HTTP are unencrypted.

You'll need a domain pointed at your server's public IP. If you don't want to buy one, [DuckDNS](https://duckdns.org) hands out free subdomains that work with Let's Encrypt. Register two — one for the client, one for the server:

| Subdomain          | Points to                  |
| ------------------ | -------------------------- |
| `chat.example.com` | Client (→ localhost:3001)  |
| `api.example.com`  | Server (→ localhost:3000)  |

Install nginx and certbot, then add a site config that reverse-proxies each subdomain to its local port:

```nginx
server {
    listen 80;
    server_name chat.example.com;
    location / { proxy_pass http://127.0.0.1:3001; }
}

server {
    listen 80;
    server_name api.example.com;
    location / { proxy_pass http://127.0.0.1:3000; }
}
```

Then let certbot issue the certificates and turn on HTTPS:

```bash
sudo certbot --nginx -d chat.example.com -d api.example.com
```

Share `https://chat.example.com` with your friends. On first load they'll enter your server address (`api.example.com`) and pick a username and password. That's it.

Prefer Caddy, a Cloudflare origin certificate, or another reverse proxy? Any of them work — pick what you're comfortable with.

---

## Contributing

No vibecoding allowed. Agentic assistance is allowed, as long as the code is thoroughly understood by the author and is reviewed by other engineers on the team. We are not anti-AI, but we are against vibecoded vaporware.
