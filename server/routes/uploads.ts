import { Router, Request, Response } from "express";
import { authenticate } from "../auth";
import { upload } from "../upload";

const router = Router();

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

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "bot" },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
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
