import { useEffect, useState } from "react";
import { FileIcon, Loader2 } from "lucide-react";
import { decryptFile } from "~/lib/crypto";
import { getProtocol } from "~/lib/protocol";
import { getMimeType } from "~/lib/attachment-utils";
import AttachmentRenderer from "~/components/ui/attachment-renderer";

type EncryptedAttachment = { url: string; iv: string; name: string };

interface EncryptedAttachmentsProps {
  attachments: string[];
  sharedKey: CryptoKey;
  serverIP: string;
}

function parseAttachment(raw: string): EncryptedAttachment | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.url && parsed.iv && parsed.name) return parsed;
  } catch {}
  return null;
}

function DecryptedFile({ att, sharedKey, serverIP }: { att: EncryptedAttachment; sharedKey: CryptoKey; serverIP: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const protocol = getProtocol(serverIP);

  useEffect(() => {
    let revoke: string | null = null;

    async function load() {
      try {
        const res = await fetch(`${protocol}://${serverIP}${att.url}`);
        const encrypted = await res.arrayBuffer();
        const decrypted = await decryptFile(sharedKey, att.iv, encrypted);
        const url = URL.createObjectURL(new Blob([decrypted], { type: getMimeType(att.name) }));
        revoke = url;
        setObjectUrl(url);
      } catch {
        setError(true);
      }
    }
    load();

    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [att.url, att.iv, att.name]);

  if (error) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-muted w-fit text-sm text-muted-foreground">
        <FileIcon className="w-5 h-5 shrink-0" />
        <span className="truncate max-w-48">{att.name}</span>
        <span className="text-destructive text-xs">Decryption failed</span>
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-muted w-fit text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        <span className="truncate max-w-48">{att.name}</span>
      </div>
    );
  }

  return <AttachmentRenderer src={objectUrl} filename={att.name} />;
}

export default function EncryptedAttachments({ attachments, sharedKey, serverIP }: EncryptedAttachmentsProps) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((raw, i) => {
        const att = parseAttachment(raw);
        if (!att) return null;
        return <DecryptedFile key={`${att.url}-${i}`} att={att} sharedKey={sharedKey} serverIP={serverIP} />;
      })}
    </div>
  );
}
