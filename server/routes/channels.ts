import { Router, Request, Response } from "express";
import { Channels, Messages } from "../db";
import { authenticate } from "../auth";

const router = Router();

router.get("/channels", (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  return res.status(200).json({ channels: Channels.getAll() });
});

router.post("/channels", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (auth.role === 'member') return res.sendStatus(403);
  const { name, type } = req.body;
  if (!name?.trim() || !['text', 'voice'].includes(type)) {
    return res.status(400).json({ error: "Name and type (text/voice) are required" });
  }
  const channel = Channels.create({ name: name.trim(), type });
  return res.status(200).json({ channel });
});

// Message endpoint (paginated, cursor-based)
router.get("/channels/:channelId/messages", (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const before = req.query.before as string | undefined;

  let all = Messages.getAll()
    .filter((m: any) => m.channelId === req.params.channelId)
    .sort((a: any, b: any) => (b as any).timestamp.localeCompare((a as any).timestamp)); // newest first

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

// Single message endpoint (for reply preview lookups)
router.get("/messages/:messageId", (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  const message = Messages.get((m: any) => m.__id === req.params.messageId);
  if (!message) return res.sendStatus(404);
  return res.status(200).json(message);
});

export default router;
