import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

type OgData = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
};

interface LinkPreviewProps {
  url: string;
  serverIP: string;
  accessToken: string;
}

export default function LinkPreview({ url, serverIP, accessToken }: LinkPreviewProps) {
  const [og, setOg] = useState<OgData | null>(null);
  const [failed, setFailed] = useState(false);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  useEffect(() => {
    let cancelled = false;
    fetch(`${protocol}://${serverIP}/link-preview?url=${encodeURIComponent(url)}`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (!cancelled && (data.title || data.image)) {
          setOg(data);
        } else if (!cancelled) {
          setFailed(true);
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed || !og) return null;

  // Special embed for YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block max-w-md mt-1 rounded-lg border bg-muted/50 overflow-hidden hover:bg-muted/80 transition-colors no-underline text-inherit"
    >
      {ytMatch ? (
        <div className="relative aspect-video w-full">
          <img
            src={`https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`}
            alt={og.title || "YouTube video"}
            className="w-full h-full object-cover"

          />
          {/* Play button overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center">
              <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[14px] border-l-white ml-1" />
            </div>
          </div>
        </div>
      ) : og.image ? (
        <img
          src={og.image}
          alt={og.title || "Link preview"}
          className="w-full max-h-48 object-cover"
        />
      ) : null}
      <div className="p-3">
        {og.siteName && (
          <p className="text-xs text-muted-foreground mb-0.5">{og.siteName}</p>
        )}
        {og.title && (
          <p className="text-sm font-semibold leading-snug line-clamp-2">{og.title}</p>
        )}
        {og.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{og.description}</p>
        )}
        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
          <ExternalLink className="w-3 h-3" />
          <span className="truncate">{new URL(url).hostname}</span>
        </div>
      </div>
    </a>
  );
}
