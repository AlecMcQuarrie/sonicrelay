import { Router, Request, Response } from "express";
import { Channels, Messages, DirectMessages, DmConversations, LastReads, upsertLastRead } from "../db";
import { authenticate } from "../auth";

const router = Router();

router.get("/unread-counts", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);

  const unreads: Record<string, number> = {};

  // Count unread messages per text channel
  const textChannels = Channels.getAll().filter((c: any) => c.type === "text");
  for (const channel of textChannels) {
    const channelId = (channel as any).__id;
    const lastRead = LastReads.get(
      (r: any) => r.username === auth.username && r.targetId === channelId
    );
    const messages = Messages.getAll().filter((m: any) => {
      if (m.channelId !== channelId) return false;
      if (m.sender === auth.username) return false;
      if (lastRead && m.timestamp <= (lastRead as any).timestamp) return false;
      return true;
    });
    if (messages.length > 0) unreads[channelId] = messages.length;
  }

  // Count unread DMs per conversation partner
  const conversations = DmConversations.getAll().filter(
    (c: any) => c.username === auth.username
  );
  for (const conv of conversations) {
    const partner = (conv as any).partner;
    const conversationId = [auth.username, partner].sort().join(':');
    const lastRead = LastReads.get(
      (r: any) => r.username === auth.username && r.targetId === partner
    );
    const dms = DirectMessages.getAll().filter((m: any) => {
      if (m.conversationId !== conversationId) return false;
      if (m.sender === auth.username) return false;
      if (lastRead && m.timestamp <= (lastRead as any).timestamp) return false;
      return true;
    });
    if (dms.length > 0) unreads[partner] = dms.length;
  }

  return res.status(200).json({ unreads });
});

router.put("/read/:targetId", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const targetId = req.params.targetId as string;
  upsertLastRead(auth.username, targetId, new Date().toISOString());
  return res.sendStatus(200);
});

export default router;
