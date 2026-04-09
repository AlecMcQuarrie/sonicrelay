import { Router, Request, Response } from "express";
import { Users, type Role } from "../db";
import { authenticate } from "../auth";
import { clients, broadcastToAll } from "../clients";

const router = Router();

// Users endpoint — excludes banned users from the list
router.get("/users", (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  const users = Users.getAll()
    .filter((u) => !u.banned)
    .map((u) => ({
      username: u.username,
      profilePhoto: u.profilePhoto || null,
      role: (u.role || 'member') as Role,
      publicKey: (u as any).publicKey || null,
    }));
  return res.status(200).json({ users });
});

// Admin/superadmin: promote or demote a user
router.put("/users/:username/role", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (auth.role === 'member') return res.sendStatus(403);
  const role = req.body.role as Role;
  if (role !== 'admin' && role !== 'member') return res.sendStatus(400); // can't assign superadmin via API
  const target = Users.get((u) => u.username === req.params.username);
  if (!target) return res.sendStatus(404);
  const targetRole = target.role || 'member';
  // Nobody can modify a superadmin
  if (targetRole === 'superadmin') return res.sendStatus(403);
  // Prevent self-demotion (lockout guard)
  if (target.username === auth.username) return res.sendStatus(400);
  // Regular admins can only promote members, not demote other admins
  if (auth.role === 'admin' && targetRole === 'admin') return res.sendStatus(403);
  Users.update((u) => { u.role = role; }, (u) => u.username === req.params.username);
  broadcastToAll({ type: 'role-changed', username: req.params.username, role });
  return res.sendStatus(200);
});

// Admin/superadmin: ban a user (soft delete). Closes their WS and blocks future login.
router.post("/users/:username/ban", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (auth.role === 'member') return res.sendStatus(403);
  const target = Users.get((u) => u.username === req.params.username);
  if (!target) return res.sendStatus(404);
  const targetRole = target.role || 'member';
  // Nobody can ban a superadmin
  if (targetRole === 'superadmin') return res.sendStatus(403);
  // Regular admins can't ban other admins — only superadmins can
  if (auth.role === 'admin' && targetRole === 'admin') return res.sendStatus(403);
  if (target.username === auth.username) return res.sendStatus(400);
  Users.update((u) => { u.banned = true; }, (u) => u.username === req.params.username);
  // Close any active connections for the banned user
  for (const [ws, client] of clients) {
    if (client.username === target.username) ws.close(4003, 'banned');
  }
  broadcastToAll({ type: 'user-banned', username: target.username });
  return res.sendStatus(200);
});

export default router;
