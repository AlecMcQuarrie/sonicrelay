import { Router, Request, Response } from "express";
import { Users, type Role, type UserSettings, type CustomThemeColors } from "../db";
import { authenticate } from "../auth";
import { upload } from "../upload";
import { broadcastUserKey, broadcastToAll } from "../clients";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = Router();

router.post("/signup", async (req: Request, res: Response) => {
  // If username already exists
  if (Users.get((x) => x.username === req.body.username)) {
    return res.sendStatus(500);
  }

  // Create user and hash password
  const password = await bcrypt.hash(req.body.password, +(process.env.SALT || 12));

  const user = {
    username: req.body.username,
    password: password,
    profilePhoto: null,
    voicePeerSettings: null,
    screenAudioPeerSettings: null,
    role: 'member' as Role,
    banned: false,
    nameColor: null,
    settings: null,
    publicKey: req.body.publicKey || null,
    encryptedPrivateKey: req.body.encryptedPrivateKey || null,
    pbkdfSalt: req.body.pbkdfSalt || null,
  };
  Users.create(user);

  // Tokens intentionally have no expiry — see note on the login handler.
  const token = jwt.sign(
    { username: user.username },
    process.env.ENCRYPTION_KEY,
  );
  return res.status(200).json({ accessToken: token });
});

// Dummy bcrypt hash used when the username doesn't exist, so login timing
// and response status don't reveal whether the account is real.
const DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstuuQ1ZsUQZKJbUeUcZqkQGZb6Y8pxS.xQnW';

router.post("/login", async (req: Request, res: Response) => {
  const user = Users.get((x) => x.username === req.body.username);
  const hash = user ? user.password : DUMMY_HASH;
  const ok = await bcrypt.compare(req.body.password || '', hash);
  if (!ok || !user) return res.sendStatus(401);
  if (user.banned) return res.sendStatus(403);
  // Tokens intentionally have no expiry — ban and role changes take effect
  // immediately because authenticate() re-reads user state from the DB on
  // every request (see server/auth.ts).
  const token = jwt.sign(
    { username: user.username },
    process.env.ENCRYPTION_KEY,
  );
  return res.status(200).json({
    accessToken: token,
    encryptedPrivateKey: (user as any).encryptedPrivateKey || null,
    pbkdfSalt: (user as any).pbkdfSalt || null,
  });
});

router.post("/me", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const user = Users.get((u) => u.username === auth.username);
  return res.status(200).json({
    username: auth.username,
    profilePhoto: user?.profilePhoto || null,
    role: auth.role,
    nameColor: user?.nameColor || null,
  });
});

// Name color: null to clear, or a #RRGGBB hex string.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
router.put("/me/name-color", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const raw = req.body?.nameColor;
  const nameColor: string | null = raw === null ? null : (typeof raw === 'string' && HEX_COLOR.test(raw) ? raw : undefined as any);
  if (nameColor === undefined) return res.sendStatus(400);
  Users.update((u) => { u.nameColor = nameColor; }, (u) => u.username === auth.username);
  broadcastToAll({ type: 'name-color-changed', username: auth.username, nameColor });
  return res.status(200).json({ nameColor });
});

router.put("/me/profile-photo", upload.single('file'), (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const file = req.file as Express.Multer.File;
  if (!file) return res.sendStatus(400);
  const url = `/uploads/${file.filename}`;
  Users.update((u) => { u.profilePhoto = url; }, (u) => u.username === auth.username);
  return res.status(200).json({ profilePhoto: url });
});

// ── User settings (sync across devices) ────────────────────────────────────
// Whitelist of known keys + per-key validators. Unknown keys and invalid
// values are silently dropped so bad clients can't poison the blob and
// so the endpoint is forward-compatible with future settings.
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const SETTING_VALIDATORS: Record<string, (v: unknown) => unknown | undefined> = {
  micGain: (v) => typeof v === 'number' && v >= 0 && v <= 5 ? v : undefined,
  speakerGain: (v) => typeof v === 'number' && v >= 0 && v <= 5 ? v : undefined,
  vadMode: (v) => v === 'off' || v === 'auto' || v === 'manual' ? v : undefined,
  vadThreshold: (v) => typeof v === 'number' && v >= 0 && v <= 100 ? v : undefined,
  pttEnabled: (v) => typeof v === 'boolean' ? v : undefined,
  pttKey: (v) => typeof v === 'string' && v.length <= 32 ? v : undefined,
  theme: (v) => typeof v === 'string' && v.length <= 32 ? v : undefined,
  customThemeColors: (v) => {
    if (!v || typeof v !== 'object') return undefined;
    const keys: (keyof CustomThemeColors)[] = ['background', 'card', 'foreground', 'primary', 'destructive'];
    const out: Partial<CustomThemeColors> = {};
    for (const k of keys) {
      const val = (v as Record<string, unknown>)[k];
      if (typeof val !== 'string' || !HEX6.test(val)) return undefined;
      out[k] = val;
    }
    return out as CustomThemeColors;
  },
};

function validateSettings(body: unknown): UserSettings {
  if (!body || typeof body !== 'object') return {};
  const clean: UserSettings = {};
  for (const [key, validator] of Object.entries(SETTING_VALIDATORS)) {
    if (!(key in (body as object))) continue;
    const valid = validator((body as Record<string, unknown>)[key]);
    if (valid !== undefined) (clean as any)[key] = valid;
  }
  return clean;
}

router.get("/me/settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const user = Users.get((u) => u.username === auth.username);
  return res.status(200).json({ settings: user?.settings || {} });
});

router.put("/me/settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const patch = validateSettings(req.body);
  const user = Users.get((u) => u.username === auth.username);
  if (!user) return res.sendStatus(404);
  const merged: UserSettings = { ...(user.settings || {}), ...patch };
  Users.update((u) => { u.settings = merged; }, (u) => u.username === auth.username);
  return res.status(200).json({ settings: merged });
});

// Voice peer settings endpoints
router.get("/me/voice-peer-settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const user = Users.get((u) => u.username === auth.username);
  return res.status(200).json({ voicePeerSettings: user?.voicePeerSettings || {} });
});

router.put("/me/voice-peer-settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const { peerUsername, volume, muted } = req.body;
  if (!peerUsername) return res.sendStatus(400);
  const user = Users.get((u) => u.username === auth.username);
  if (!user) return res.sendStatus(404);
  const settings = (user as any).voicePeerSettings || {};
  settings[peerUsername] = { volume: volume ?? 1, muted: muted ?? false };
  Users.update((u) => { (u as any).voicePeerSettings = settings; }, (u) => u.username === auth.username);
  return res.status(200).json({ voicePeerSettings: settings });
});

// Encryption key upload — for existing accounts that don't have keys yet
router.put("/me/encryption-keys", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const { publicKey, encryptedPrivateKey, pbkdfSalt } = req.body;
  if (!publicKey || !encryptedPrivateKey || !pbkdfSalt) return res.sendStatus(400);
  Users.update((u) => {
    (u as any).publicKey = publicKey;
    (u as any).encryptedPrivateKey = encryptedPrivateKey;
    (u as any).pbkdfSalt = pbkdfSalt;
  }, (u) => u.username === auth.username);
  broadcastUserKey(auth.username, publicKey);
  return res.sendStatus(200);
});

// Screen audio peer settings endpoints
router.get("/me/screen-audio-peer-settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const user = Users.get((u) => u.username === auth.username);
  return res.status(200).json({ screenAudioPeerSettings: user?.screenAudioPeerSettings || {} });
});

router.put("/me/screen-audio-peer-settings", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const { peerUsername, volume, muted } = req.body;
  if (!peerUsername) return res.sendStatus(400);
  const user = Users.get((u) => u.username === auth.username);
  if (!user) return res.sendStatus(404);
  const settings = (user as any).screenAudioPeerSettings || {};
  settings[peerUsername] = { volume: volume ?? 1, muted: muted ?? false };
  Users.update((u) => { (u as any).screenAudioPeerSettings = settings; }, (u) => u.username === auth.username);
  return res.status(200).json({ screenAudioPeerSettings: settings });
});

export default router;
