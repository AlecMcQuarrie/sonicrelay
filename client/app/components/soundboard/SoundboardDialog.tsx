import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { getProtocol } from "~/lib/protocol";
import type { Soundboard } from "~/lib/soundboard";
import { clearSoundCache } from "~/lib/soundboard";
import SoundUploadDialog from "./SoundUploadDialog";

interface SoundboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sounds: Soundboard[];
  isAdmin: boolean;
  serverIP: string;
  accessToken: string;
  onPlay: (soundId: string) => void;
  onSoundsChanged: () => void;
}

export default function SoundboardDialog({
  open, onOpenChange, sounds, isAdmin, serverIP, accessToken, onPlay, onSoundsChanged,
}: SoundboardDialogProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (open) onSoundsChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const deleteSound = async (id: string) => {
    const protocol = getProtocol(serverIP);
    const res = await fetch(`${protocol}://${serverIP}/soundboard/${id}`, {
      method: "DELETE",
      headers: { "access-token": accessToken },
    });
    if (res.ok) {
      clearSoundCache(id);
      onSoundsChanged();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Soundboard</DialogTitle>
          </DialogHeader>

          {sounds.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {isAdmin ? "No sounds yet. Click below to add one." : "No sounds yet."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {sounds.map((s) => (
                <div key={s.__id} className="relative group">
                  <Button
                    variant="outline"
                    className="w-full h-20 flex flex-col items-center justify-center gap-1 p-2"
                    onClick={() => onPlay(s.__id)}
                  >
                    <span className="text-2xl leading-none">{s.emoji}</span>
                    <span className="text-xs truncate max-w-full">{s.name}</span>
                  </Button>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label={`Delete ${s.name}`}
                      onClick={(e) => { e.stopPropagation(); deleteSound(s.__id); }}
                      className="absolute top-1 right-1 p-1 rounded bg-background/80 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setUploadOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" /> Add Sound
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {isAdmin && (
        <SoundUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          serverIP={serverIP}
          accessToken={accessToken}
          onUploaded={onSoundsChanged}
        />
      )}
    </>
  );
}
