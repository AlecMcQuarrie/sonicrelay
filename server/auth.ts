import { Request } from "express";
import { Users, type Role } from "./db";

const jwt = require("jsonwebtoken");

// Look up caller's identity and role from access-token header.
// Role and banned status are read fresh from the DB on every request
// so promotions/demotions/bans take effect without re-issuing tokens.
export function authenticate(req: Request): { username: string; role: Role } | null {
  const token = req.headers["access-token"] as string | undefined;
  if (!token) return null;
  try {
    const { username } = jwt.verify(token, process.env.ENCRYPTION_KEY);
    if (!username) return null;
    const user = Users.get((u) => u.username === username);
    if (!user || user.banned) return null;
    return { username, role: user.role || 'member' };
  } catch {
    return null;
  }
}
