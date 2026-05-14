import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Slider } from "~/components/ui/slider";
import { getProtocol } from "~/lib/protocol";

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
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewStopRef = useRef<number | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Revoke any active blob URL when the dialog closes or the file changes.
  useEffect(() => {
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [objectUrl]);

  const reset = () => {
    setFile(null);
    setObjectUrl(null);
    setDuration(0);
    setTrim([0, 0]);
    setName("");
    setEmoji("");
    setError(null);
    setSubmitting(false);
    if (previewStopRef.current) {
      cancelAnimationFrame(previewStopRef.current);
      previewStopRef.current = null;
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setFile(f);
    setObjectUrl(URL.createObjectURL(f));
    setDuration(0);
    setTrim([0, 0]);
  };

  const onLoadedMetadata = () => {
    const d = audioRef.current?.duration ?? 0;
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    setTrim([0, d]);
  };

  const previewTrimmed = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = trim[0];
    audio.play().catch(() => {});
    const tick = () => {
      if (!audio || audio.paused) { previewStopRef.current = null; return; }
      if (audio.currentTime >= trim[1]) {
        audio.pause();
        previewStopRef.current = null;
        return;
      }
      previewStopRef.current = requestAnimationFrame(tick);
    };
    if (previewStopRef.current) cancelAnimationFrame(previewStopRef.current);
    previewStopRef.current = requestAnimationFrame(tick);
  };

  const handleSubmit = async () => {
    if (!file || duration <= 0) return;
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
            <audio
              ref={audioRef}
              src={objectUrl ?? undefined}
              controls
              onLoadedMetadata={onLoadedMetadata}
              className="w-full"
            />
            {duration > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Trim</label>
                <Slider
                  min={0}
                  max={duration}
                  step={0.01}
                  value={trim}
                  onValueChange={(v) => setTrim([v[0], v[1]] as [number, number])}
                />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{trim[0].toFixed(2)}s</span>
                  <span>{trim[1].toFixed(2)}s</span>
                </div>
                <Button variant="ghost" size="sm" onClick={previewTrimmed}>
                  Preview trimmed
                </Button>
              </div>
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
          <Button onClick={handleSubmit} disabled={!file || submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
