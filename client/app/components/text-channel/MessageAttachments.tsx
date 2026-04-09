import { getFilename } from "~/lib/attachment-utils";
import { getProtocol } from "~/lib/protocol";
import AttachmentRenderer from "~/components/ui/attachment-renderer";

interface MessageAttachmentsProps {
  attachments: string[];
  serverIP: string;
}

export default function MessageAttachments({ attachments, serverIP }: MessageAttachmentsProps) {
  const protocol = getProtocol(serverIP);

  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((url, i) => (
        <AttachmentRenderer
          key={i}
          src={`${protocol}://${serverIP}${url}`}
          filename={getFilename(url)}
        />
      ))}
    </div>
  );
}
