import { Download, FileIcon } from "lucide-react";
import AudioPlayer from "~/components/text-channel/AudioPlayer";
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, getExt, getMimeType } from "~/lib/attachment-utils";

interface AttachmentRendererProps {
  src: string;
  filename: string;
}

export default function AttachmentRenderer({ src, filename }: AttachmentRendererProps) {
  const ext = getExt(filename);

  if (IMAGE_EXTS.includes(ext)) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img
          src={src}
          alt={filename}
          className="max-w-xs max-h-60 rounded border object-contain cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }

  if (VIDEO_EXTS.includes(ext)) {
    return (
      <div className="max-w-sm aspect-video">
        <video controls className="w-full h-full rounded border object-contain bg-black">
          <source src={src} type={getMimeType(filename)} />
        </video>
      </div>
    );
  }

  if (AUDIO_EXTS.includes(ext)) {
    return <AudioPlayer src={src} filename={filename} />;
  }

  return (
    <a
      href={src}
      download={filename}
      className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-muted hover:bg-muted/80 transition-colors w-fit"
    >
      <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
      <span className="text-sm truncate max-w-48">{filename}</span>
      <Download className="w-4 h-4 text-muted-foreground shrink-0" />
    </a>
  );
}
