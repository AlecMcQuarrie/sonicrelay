import { Router, Request, Response } from "express";
import { DirectMessages, DmConversations } from "../db";
import { authenticate } from "../auth";

const router = Router();

// DM conversations — list distinct conversation partners for the current user
router.get("/dm/conversations", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);

  const conversations = DmConversations.getAll()
    .filter((c: any) => c.username === auth.username)
    .sort((a: any, b: any) => b.lastTimestamp.localeCompare(a.lastTimestamp))
    .map((c: any) => ({ partner: c.partner, lastTimestamp: c.lastTimestamp }));

  return res.status(200).json({ conversations });
});

// DM messages — paginated encrypted messages between current user and :partner
router.get("/dm/messages/:partner", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const conversationId = [auth.username, req.params.partner].sort().join(':');
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const before = req.query.before as string | undefined;

  let all = DirectMessages.getAll()
    .filter((m: any) => m.conversationId === conversationId)
    .sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp)); // newest first

  if (before) {
    const idx = all.findIndex((m: any) => (m as any).__id === before);
    if (idx !== -1) all = all.slice(idx + 1);
  }

  const page = all.slice(0, limit);
  return res.status(200).json({
    messages: page.reverse(), // return oldest→newest for display
    hasMore: all.length > limit,
  });
});

// Single DM message — for reply preview lookups (returns encrypted data)
router.get("/dm/message/:messageId", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const messageId = req.params.messageId as string;
  const dm = DirectMessages.get((m: any) => m.__id === messageId);
  if (!dm) return res.sendStatus(404);
  if (!dm.conversationId.split(':').includes(auth.username)) return res.sendStatus(404);
  return res.status(200).json(dm);
});

export default router;
