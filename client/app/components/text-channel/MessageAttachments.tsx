import { getFilename } from "~/lib/attachment-utils";
import { buildUploadUrl } from "~/lib/protocol";
import AttachmentRenderer from "~/components/ui/attachment-renderer";

interface MessageAttachmentsProps {
  attachments: string[];
  serverIP: string;
  uploadToken: string | null;
}

export default function MessageAttachments({ attachments, serverIP, uploadToken }: MessageAttachmentsProps) {
  if (!uploadToken) return null;
  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((url, i) => (
        <AttachmentRenderer
          key={i}
          src={buildUploadUrl(url, serverIP, uploadToken)}
          filename={getFilename(url)}
        />
      ))}
    </div>
  );
}
