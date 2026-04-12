import { getFilename } from "~/lib/attachment-utils";
import { buildUploadUrl } from "~/lib/protocol";
import AttachmentRenderer from "~/components/ui/attachment-renderer";

interface MessageAttachmentsProps {
  attachments: string[];
  serverIP: string;
  accessToken: string;
}

export default function MessageAttachments({ attachments, serverIP, accessToken }: MessageAttachmentsProps) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((url, i) => (
        <AttachmentRenderer
          key={i}
          src={buildUploadUrl(url, serverIP, accessToken)}
          filename={getFilename(url)}
        />
      ))}
    </div>
  );
}
