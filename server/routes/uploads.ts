import { Router, Request, Response } from "express";
import path from "path";
import net from "net";
import { authenticate } from "../auth";
import { Users } from "../db";
import { upload } from "../upload";

const jwt = require("jsonwebtoken");

const router = Router();

// Block SSRF targets: loopback, private ranges, link-local, cloud metadata,
// IPv6 equivalents (including IPv4-mapped forms like ::ffff:169.254.169.254
// which Node normalizes to ::ffff:a9fe:a9fe), and common internal TLDs.
// Node's URL parser returns IPv6 literals wrapped in brackets, so we strip
// them before applying prefix/isIP checks. DNS rebinding is out of scope
// for this threat model.
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.internal') || lower.endsWith('.local')) return true;

  const host = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
  const v = net.isIP(host);
  if (v === 0) return false; // plain hostname, not an IP literal

  if (v === 4) {
    if (host === '0.0.0.0') return true;
    if (host.startsWith('127.')) return true;         // 127.0.0.0/8 loopback
    if (host.startsWith('10.')) return true;          // 10.0.0.0/8 private
    if (host.startsWith('192.168.')) return true;     // 192.168.0.0/16 private
    if (host.startsWith('169.254.')) return true;     // 169.254.0.0/16 link-local (incl. 169.254.169.254)
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true; // 172.16.0.0/12
    return false;
  }

  // v === 6
  if (host === '::1' || host === '::') return true;
  if (host.startsWith('::ffff:')) return true;        // all IPv4-mapped addresses
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(host)) return true;            // fe80::/10 link-local
  if (host.startsWith('64:ff9b:')) return true;       // well-known NAT64 prefix
  return false;
}

// Short-lived upload-scoped tokens. The session JWT is non-expiring by
// design, so we don't want it in URLs where it ends up in access logs,
// browser history, etc. Instead, clients request a short-lived token with
// a { type: 'upload' } claim and embed THAT in image URLs. If it leaks
// into a log, it expires quickly and can't hit any other endpoint.
const UPLOAD_TOKEN_TTL_SECONDS = 600; // 10 minutes

router.post("/upload-token", (req: Request, res: Response) => {
  const auth = authenticate(req);
  if (!auth) return res.sendStatus(401);
  const uploadToken = jwt.sign(
    { type: 'upload', username: auth.username },
    process.env.ENCRYPTION_KEY,
    { expiresIn: UPLOAD_TOKEN_TTL_SECONDS },
  );
  return res.status(200).json({ uploadToken, expiresIn: UPLOAD_TOKEN_TTL_SECONDS });
});

// Authenticated static file serving for uploaded files. Two auth paths:
//   1. Session JWT via `access-token` header — used by fetch-based loads
//      (e.g. the E2EE DM attachment fetcher). Goes through authenticate()
//      so ban state is re-read from the DB on every request.
//   2. Short-lived upload token via `?token=` query param — used by
//      <img src>/<video src> loads, since the browser won't send custom
//      headers on those. The token must have the 'upload' type claim so
//      a leaked full-session JWT can't be reused via the query path.
// path.basename strips any path segments so a traversal attempt can't
// escape the uploads dir.
router.get("/uploads/:filename", (req: Request, res: Response) => {
  const headerToken = req.headers["access-token"] as string | undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  let authed = false;
  if (headerToken) {
    const fakeReq = { headers: { "access-token": headerToken } } as unknown as Request;
    authed = !!authenticate(fakeReq);
  } else if (queryToken) {
    try {
      const payload = jwt.verify(queryToken, process.env.ENCRYPTION_KEY) as any;
      if (payload?.type === 'upload' && typeof payload.username === 'string') {
        const user = Users.get((u) => u.username === payload.username);
        if (user && !user.banned) authed = true;
      }
    } catch { /* expired or invalid — falls through to 401 */ }
  }
  if (!authed) return res.sendStatus(401);

  const filename = path.basename(String(req.params.filename));
  return res.sendFile(path.join(__dirname, "..", "uploads", filename));
});

router.post("/upload", upload.array('files', 10), (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);
  const files = req.files as Express.Multer.File[];
  const urls = files.map((f) => `/uploads/${f.filename}`);
  return res.status(200).json({ urls });
});

// Link preview endpoint — fetches Open Graph metadata from a URL
router.get("/link-preview", async (req: Request, res: Response) => {
  if (!authenticate(req)) return res.sendStatus(401);

  const url = req.query.url as string;
  if (!url) return res.sendStatus(400);

  // SSRF protection: only http/https, and a robust host blocklist. See
  // isBlockedHost for details. DNS rebinding is out of scope.
  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.sendStatus(400); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.sendStatus(400);
  if (isBlockedHost(parsed.hostname)) return res.sendStatus(400);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "bot" },
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(200).json({ title: null, description: null, image: null, siteName: null, url });
    }

    const html = await response.text();

    const getTag = (property: string): string | null => {
      const match = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, 'i'));
      return match ? match[1] : null;
    };

    // Fallback title from <title> tag
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);

    const data = {
      title: getTag("og:title") || getTag("twitter:title") || (titleTag ? titleTag[1].trim() : null),
      description: getTag("og:description") || getTag("twitter:description") || getTag("description"),
      image: getTag("og:image") || getTag("twitter:image"),
      siteName: getTag("og:site_name"),
      url,
    };

    return res.status(200).json(data);
  } catch {
    return res.status(200).json({ title: null, description: null, image: null, siteName: null, url });
  }
});

export default router;
