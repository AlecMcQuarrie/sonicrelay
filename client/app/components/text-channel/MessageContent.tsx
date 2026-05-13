import { useMemo } from "react";
import LinkPreview from "./LinkPreview";
import type { OgData } from "~/lib/preload-media";
import { highlight, escapeHtml } from "~/lib/highlight";
import { parseForRender } from "~/lib/messageFormat";

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

interface MessageContentProps {
  text: string;
  serverIP: string;
  accessToken: string;
  ogCache?: Map<string, OgData>;
}

export default function MessageContent({ text, serverIP, accessToken, ogCache }: MessageContentProps) {
  const segments = useMemo(() => parseForRender(text), [text]);

  // Collect URLs only from text segments — never from inside code.
  const urls = useMemo(() => {
    const found: string[] = [];
    for (const seg of segments) {
      if (seg.kind !== "text") continue;
      const re = new RegExp(URL_REGEX);
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.text)) !== null) found.push(m[0]);
    }
    return [...new Set(found)];
  }, [segments]);

  let key = 0;

  return (
    <div className="min-w-0">
      {segments.map((seg) => {
        if (seg.kind === "block") {
          const html = highlight(seg.code, seg.lang);
          return (
            <pre key={key++} className="my-1 rounded-md bg-muted/70 border border-border/60 px-3 py-2 overflow-x-auto text-xs leading-relaxed">
              <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          );
        }
        if (seg.kind === "inline") {
          return (
            <code
              key={key++}
              className="font-mono text-[0.85em] rounded bg-muted/70 border border-border/60 px-1 py-0.5 [overflow-wrap:anywhere]"
              dangerouslySetInnerHTML={{ __html: escapeHtml(seg.code) }}
            />
          );
        }
        // Plain text segment — render with URL detection inline.
        return <TextWithLinks key={key++} text={seg.text} />;
      })}
      {urls.map((url) => (
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

function TextWithLinks({ text }: { text: string }) {
  const parts: (string | { url: string; key: number })[] = [];
  let lastIndex = 0;
  let keyCounter = 0;
  const re = new RegExp(URL_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push({ url: m[0], key: keyCounter++ });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
      {parts.map((part) =>
        typeof part === "string" ? (
          part
        ) : (
          <a
            key={part.key}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline [overflow-wrap:anywhere]"
          >
            {part.url}
          </a>
        )
      )}
    </span>
  );
}
