import LinkPreview from "./LinkPreview";
import type { OgData } from "./TextChannel";

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

interface MessageContentProps {
  text: string;
  serverIP: string;
  accessToken: string;
  ogCache?: Map<string, OgData>;
}

export default function MessageContent({ text, serverIP, accessToken, ogCache }: MessageContentProps) {
  // Find all URLs in the message
  const urls: string[] = [];
  const parts: (string | { url: string; key: number })[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  const regex = new RegExp(URL_REGEX);
  while ((match = regex.exec(text)) !== null) {
    // Text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push({ url, key: keyCounter++ });
    urls.push(url);
    lastIndex = regex.lastIndex;
  }
  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // Deduplicate URLs for previews
  const uniqueUrls = [...new Set(urls)];

  return (
    <div>
      <p className="whitespace-pre-wrap break-words">
        {parts.map((part) =>
          typeof part === "string" ? (
            part
          ) : (
            <a
              key={part.key}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {part.url}
            </a>
          )
        )}
      </p>
      {uniqueUrls.map((url) => (
        <LinkPreview
          key={url}
          url={url}
          serverIP={serverIP}
          accessToken={accessToken}
          cachedOg={ogCache?.get(url)}
        />
      ))}
    </div>
  );
}
