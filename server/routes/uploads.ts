import { Router, Request, Response } from "express";
import path from "path";
import { authenticate } from "../auth";
import { upload } from "../upload";

const router = Router();

// Authenticated static file serving for uploaded files. Accepts the JWT
// via the `access-token` header (used by fetch-based loads) OR a `?token=`
// query param (needed for <img src> loads — the browser doesn't send
// custom headers on image requests). path.basename strips any path
// segments so a traversal attempt can't escape the uploads dir.
router.get("/uploads/:filename", (req: Request, res: Response) => {
  const headerToken = req.headers["access-token"] as string | undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken || queryToken;
  if (!token) return res.sendStatus(401);
  const fakeReq = { headers: { "access-token": token } } as unknown as Request;
  if (!authenticate(fakeReq)) return res.sendStatus(401);

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

  // SSRF protection: only http/https, no loopback/private/metadata hosts.
  // Does not defend against DNS rebinding — acceptable for our threat model.
  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.sendStatus(400); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.sendStatus(400);
  const host = parsed.hostname.toLowerCase();
  const isBlockedHost =
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '169.254.169.254' ||               // cloud metadata
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.startsWith('127.') ||                  // 127.0.0.0/8
    host.startsWith('10.') ||                   // 10.0.0.0/8
    host.startsWith('192.168.') ||              // 192.168.0.0/16
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || // 172.16.0.0/12
    host.startsWith('fc') || host.startsWith('fd') || // IPv6 ULA
    host.startsWith('fe80:');                   // IPv6 link-local
  if (isBlockedHost) return res.sendStatus(400);

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
