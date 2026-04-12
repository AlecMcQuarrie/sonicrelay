export type OgData = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
};

import { IMAGE_EXTS, getExt } from "~/lib/attachment-utils";

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

type PreloadableMessage = {
  messageContent?: string;
  text?: string;
  attachments?: string[];
};

/** Preload all attachment images + link preview OG data (and their images). */
export async function preloadAllMedia(
  messages: PreloadableMessage[],
  protocol: string,
  serverIP: string,
  accessToken: string,
): Promise<Map<string, OgData>> {
  const ogCache = new Map<string, OgData>();
  const imagePromises: Promise<void>[] = [];

  // Collect attachment image URLs. Upload URLs need the access token as a
  // query param because the browser can't send custom headers on <img>.
  for (const msg of messages) {
    for (const att of msg.attachments || []) {
      if (IMAGE_EXTS.includes(getExt(att))) {
        imagePromises.push(preloadImage(`${protocol}://${serverIP}${att}?token=${encodeURIComponent(accessToken)}`));
      }
    }
  }

  // Collect all unique URLs from message text for link previews
  const allUrls = new Set<string>();
  for (const msg of messages) {
    const content = msg.messageContent || msg.text || '';
    if (!content) continue;
    const matches = content.match(URL_REGEX);
    if (matches) matches.forEach((u) => allUrls.add(u));
  }

  // Fetch OG data for all URLs in parallel
  const ogPromises = [...allUrls].map(async (url) => {
    try {
      const res = await fetch(
        `${protocol}://${serverIP}/link-preview?url=${encodeURIComponent(url)}`,
        { headers: { "access-token": accessToken } },
      );
      if (!res.ok) return;
      const data: OgData = await res.json();
      if (data.title || data.image) {
        ogCache.set(url, data);
        if (data.image) {
          imagePromises.push(preloadImage(data.image));
        }
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          imagePromises.push(preloadImage(`https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`));
        }
      }
    } catch { /* skip failed previews */ }
  });

  await Promise.all(ogPromises);
  await Promise.all(imagePromises);

  return ogCache;
}
