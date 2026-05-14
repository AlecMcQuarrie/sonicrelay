import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { getProtocol } from "~/lib/protocol";
import { getSoundboardAudioContext } from "~/lib/soundboard";
import WaveformTrimmer from "./WaveformTrimmer";

interface SoundUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverIP: string;
  accessToken: string;
  onUploaded: () => void;
}

export default function SoundUploadDialog({
  open, onOpenChange, serverIP, accessToken, onUploaded,
}: SoundUploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decoding, setDecoding] = useState(false);

  const reset = () => {
    setFile(null);
    setBuffer(null);
    setTrim([0, 0]);
    setName("");
    setEmoji("");
    setError(null);
    setSubmitting(false);
    setDecoding(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/\.mp3$/i.test(f.name)) {
      setError("Please choose an .mp3 file");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("File must be 5 MB or smaller");
      return;
    }
    setError(null);
    setFile(f);
    setBuffer(null);
    setDecoding(true);
    try {
      const arrayBuffer = await f.arrayBuffer();
      const decoded = await getSoundboardAudioContext().decodeAudioData(arrayBuffer);
      setBuffer(decoded);
      setTrim([0, decoded.duration]);
    } catch {
      setError("Could not decode this audio file");
      setFile(null);
    } finally {
      setDecoding(false);
    }
  };

  const handleSubmit = async () => {
    if (!file || !buffer) return;
    const duration = buffer.duration;
    if (name.trim().length < 1 || name.trim().length > 32) {
      setError("Name must be 1–32 characters");
      return;
    }
    if (emoji.trim().length < 1 || emoji.trim().length > 8) {
      setError("Emoji must be 1–8 characters");
      return;
    }
    if (trim[0] < 0 || trim[1] > duration || trim[0] >= trim[1]) {
      setError("Invalid trim range");
      return;
    }
    setSubmitting(true);
    setError(null);

    const protocol = getProtocol(serverIP);
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim());
    form.append("emoji", emoji.trim());
    form.append("trimStart", String(trim[0]));
    form.append("trimEnd", String(trim[1]));
    form.append("duration", String(duration));

    try {
      const res = await fetch(`${protocol}://${serverIP}/soundboard`, {
        method: "POST",
        headers: { "access-token": accessToken },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Upload failed");
        setSubmitting(false);
        return;
      }
      onUploaded();
      handleOpenChange(false);
    } catch {
      setError("Upload failed");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sound</DialogTitle>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          className="hidden"
          onChange={handleFileSelect}
        />

        {!file ? (
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            Choose MP3 file
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground truncate">{file.name}</div>

            {decoding && (
              <div className="text-xs text-muted-foreground">Decoding…</div>
            )}

            {buffer && (
              <WaveformTrimmer
                buffer={buffer}
                trimStart={trim[0]}
                trimEnd={trim[1]}
                onTrimChange={(s, e) => setTrim([s, e])}
              />
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                placeholder="Airhorn"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Emoji</label>
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={8}
                placeholder="📯"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
              Choose a different file
            </Button>
          </div>
        )}

        {error && <div className="text-xs text-destructive">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!file || !buffer || submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
