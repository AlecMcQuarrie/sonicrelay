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

type Message = {
  attachments: Blob[];
  messageContent: string;
  sender: string;
  timestamp: string;
  $id: string;
};
const Messages = db.createCollection<Message>("messages");

app.use(express.json());

// Server start
app.listen(port, () => {
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
  const password = await bcrypt.hash(req.body.password, process.env.SALT);
  const user = {
    username: req.body.username,
    password: password,
  };
  Users.create(user);

  // Send 200 if successful
  return res.sendStatus(200);
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

app.post("/message", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { messageContent } = req.body;
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    Messages.create({
      messageContent,
      timestamp: new Date().toISOString(),
      sender: username,
    });
    return res.sendStatus(200);
  }
  return res.sendStatus(401);
});

app.get("/messages", (req: Request, res: Response) => {
  const accessToken = req.headers["access-token"];
  const { username } = jwt.verify(accessToken, process.env.ENCRYPTION_KEY);
  if (username) {
    const messages = Messages.getAll();
    return res.status(200).json({ messages });
  }
  return res.sendStatus(401);
});

// Websockets for real time communication
const wss = new WebSocketServer({
  port: 8080, verifyClient: (info: { req: RipV2IncomingMessage }, authenticate) => {
    const accessToken = info.req.headers["access-token"];
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
    const messageContent = JSON.parse(data.toString());
    Messages.create({
      messageContent,
      timestamp: new Date().toISOString(),
      sender: username,
    });
    wss.clients.forEach((client) => {
      if (client !== ws) {
        client.send(data)
      }
    })
  });
});
