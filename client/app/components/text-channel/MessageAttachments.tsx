import { Download, FileIcon } from "lucide-react";
import AudioPlayer from "./AudioPlayer";

interface MessageAttachmentsProps {
  attachments: string[];
  serverIP: string;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mov'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];

function getExt(url: string): string {
  return url.substring(url.lastIndexOf('.')).toLowerCase();
}

function getFilename(url: string): string {
  return url.substring(url.lastIndexOf('/') + 1);
}

export default function MessageAttachments({ attachments, serverIP }: MessageAttachmentsProps) {
  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((url, i) => {
        const fullUrl = `${protocol}://${serverIP}${url}`;
        const ext = getExt(url);

        if (IMAGE_EXTS.includes(ext)) {
          return (
            <a key={i} href={fullUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={fullUrl}
                alt="attachment"
                className="max-w-xs max-h-60 rounded border object-contain cursor-pointer hover:opacity-90 transition-opacity"
              />
            </a>
          );
        }

        if (VIDEO_EXTS.includes(ext)) {
          return (
            <div key={i} className="max-w-sm aspect-video">
              <video controls className="w-full h-full rounded border object-contain bg-black">
                <source src={fullUrl} />
              </video>
            </div>
          );
        }

        if (AUDIO_EXTS.includes(ext)) {
          return <AudioPlayer key={i} src={fullUrl} filename={getFilename(url)} />;
        }

        return (
          <a
            key={i}
            href={fullUrl}
            download
            className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-muted hover:bg-muted/80 transition-colors w-fit"
          >
            <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
            <span className="text-sm truncate max-w-48">{getFilename(url)}</span>
            <Download className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        );
      })}
    </div>
  );
}
