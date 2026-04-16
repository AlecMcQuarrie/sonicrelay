import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  },
});

// Files are served from the same origin as the app, so an uploaded .html
// or .svg can execute JS in the app's origin if a user opens the URL
// directly. Deny types that can host script content or executables; keep
// the upload flow permissive for everything else (docs, archives, media).
const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.xml', '.xsl',
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.jar', '.com', '.msi',
]);
const BLOCKED_MIMETYPES = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'text/javascript', 'application/javascript', 'application/ecmascript',
  'application/x-msdownload', 'application/x-sh', 'application/x-bat',
]);

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIMETYPES.has(file.mimetype.toLowerCase())) {
    cb(new Error('File type not allowed'));
    return;
  }
  cb(null, true);
}

export const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });
