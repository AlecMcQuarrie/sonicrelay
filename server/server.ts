const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

import express, { Request, Response } from "express";
import { Database } from "simpl.db";
import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import "dotenv/config";

type RipV2IncomingMessage = IncomingMessage & {
  username?: string;
}

const app = express();
const port = process.env.PORT || 3000;

const db = new Database();

type User = {
  username: string;
  password: string;
  $id: string;
};
const Users = db.createCollection<User>("users");

type Channel = {
  name: string;
  $id: string;
};
const Channels = db.createCollection<Channel>("channels");

type Message = {
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
  $id: string;
};
const Messages = db.createCollection<Message>("messages");

// Seed a default "general" channel if none exist
if (Channels.getAll().length === 0) {
  Channels.create({ name: "general" });
}

const cors = require('cors');
app.use(cors({ origin: 'http://localhost:5173' }));

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// parse application/json
app.use(express.json());

// Server start
const server = app.listen(port, () => {
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
    return res.status(200).json({ username });
  }
  return res.sendStatus(401);
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
    const channel = Channels.create({ name: req.body.name });
    return res.status(200).json({ channel });
  }
  return res.sendStatus(401);
});

// Message endpoints
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

// Websockets for real time communication
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

wss.on('connection', (ws, req: RipV2IncomingMessage) => {
  const { username } = req;

  ws.on('message', (data) => {
    const { channelId, messageContent } = JSON.parse(data.toString());
    const message = {
      channelId,
      messageContent,
      timestamp: new Date().toISOString(),
      sender: username,
    };
    Messages.create(message);
    wss.clients.forEach((client) => {
      if (client !== ws) {
        client.send(JSON.stringify(message));
      }
    });
  });
});
