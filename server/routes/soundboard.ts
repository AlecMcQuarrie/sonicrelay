import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { Soundboards } from "../db";
import { authenticate } from "../auth";

const router = Router();

const uploadsDir = path.join(__dirname, "..", "uploads");

// MP3-only multer instance, capped at 5 MB. Separate from the generic
// upload (50 MB, broad type allowlist) because soundboard clips need
// tighter constraints than message attachments.
const soundUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID() + ".mp3"),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (ext === ".mp3" && (mime === "audio/mpeg" || mime === "audio/mp3")) {
      cb(null, true);
    } else {
      cb(new Error("Only .mp3 audio files are allowed"));
    }
  },
});

function isAdmin(role: string | undefined) {
  return role === "admin" || role === "superadmin";
}

router.get("/soundboard", (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  // Existing rows from before the `order` field exists default to 0; new
  // uploads get max+1, and admin drag-reorder assigns explicit indices.
  const sorted = Soundboards.getAll().sort(
    (a: any, b: any) => ((a.order ?? 0) - (b.order ?? 0)) || a.uploadedAt - b.uploadedAt,
  );
  return res.status(200).json({ sounds: sorted });
});

router.post("/soundboard", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (!isAdmin(auth.role)) return res.sendStatus(403);

  soundUpload.single("file")(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing file" });

    const name = String(req.body.name ?? "").trim();
    const emoji = String(req.body.emoji ?? "").trim();
    const trimStart = Number(req.body.trimStart);
    const trimEnd = Number(req.body.trimEnd);
    const duration = Number(req.body.duration);

    const cleanup = () => fs.unlink(path.join(uploadsDir, file.filename), () => {});

    if (name.length < 1 || name.length > 32) { cleanup(); return res.status(400).json({ error: "Name must be 1–32 characters" }); }
    if (emoji.length < 1 || emoji.length > 8) { cleanup(); return res.status(400).json({ error: "Emoji must be 1–8 characters" }); }
    if (!Number.isFinite(duration) || duration <= 0) { cleanup(); return res.status(400).json({ error: "Invalid duration" }); }
    if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd)) { cleanup(); return res.status(400).json({ error: "Invalid trim values" }); }
    if (trimStart < 0 || trimEnd > duration || trimStart >= trimEnd) {
      cleanup();
      return res.status(400).json({ error: "Invalid trim range" });
    }

    const maxOrder = Soundboards.getAll().reduce(
      (m: number, s: any) => Math.max(m, s.order ?? 0), -1,
    );

    const sound = Soundboards.create({
      name,
      emoji,
      fileUrl: `/uploads/${file.filename}`,
      trimStart,
      trimEnd,
      duration,
      uploadedBy: auth.username,
      uploadedAt: Date.now(),
      order: maxOrder + 1,
    });

    return res.status(200).json({ sound });
  });
});

router.put("/soundboard/order", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (!isAdmin(auth.role)) return res.sendStatus(403);
  const { order } = req.body;
  if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) {
    return res.status(400).json({ error: "order must be an array of sound IDs" });
  }
  order.forEach((id, idx) => {
    Soundboards.update((s: any) => { s.order = idx; }, (s: any) => s.__id === id);
  });
  return res.sendStatus(204);
});

router.delete("/soundboard/:id", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  if (!isAdmin(auth.role)) return res.sendStatus(403);

  const sound = Soundboards.get((s: any) => s.__id === req.params.id);
  if (!sound) return res.sendStatus(404);

  // Resolve and confirm the file lives inside the uploads dir before unlinking.
  const filename = path.basename(sound.fileUrl);
  const filePath = path.join(uploadsDir, filename);
  fs.unlink(filePath, () => {});

  Soundboards.remove((s: any) => s.__id === req.params.id);
  return res.sendStatus(204);
});

export default router;
