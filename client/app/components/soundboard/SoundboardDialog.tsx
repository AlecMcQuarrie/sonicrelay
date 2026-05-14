import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
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
  const [editMode, setEditMode] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (open) onSoundsChanged();
    else setEditMode(false); // always reopen in safe play-only mode
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

  const reorder = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const from = sounds.findIndex((s) => s.__id === sourceId);
    const to = sounds.findIndex((s) => s.__id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...sounds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const newOrder = next.map((s) => s.__id);
    const protocol = getProtocol(serverIP);
    const res = await fetch(`${protocol}://${serverIP}/soundboard/order`, {
      method: "PUT",
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder }),
    });
    if (res.ok) onSoundsChanged();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "sm:max-w-md transition-shadow",
            editMode && "ring-2 ring-destructive",
          )}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Soundboard</DialogTitle>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={editMode ? "Exit edit mode" : "Edit soundboard"}
                  aria-pressed={editMode}
                  onClick={() => setEditMode((v) => !v)}
                  className={editMode ? "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive" : ""}
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              )}
              {editMode && (
                <span className="text-xs font-medium text-destructive uppercase tracking-wide">
                  Editing
                </span>
              )}
            </div>
          </DialogHeader>

          {sounds.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {isAdmin
                ? editMode
                  ? "No sounds yet. Click below to add one."
                  : "No sounds yet. Tap the pencil to add one."
                : "No sounds yet."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {sounds.map((s) => {
                const draggable = isAdmin && editMode;
                const isDragging = draggedId === s.__id;
                const isDragOver = dragOverId === s.__id && draggedId !== s.__id;
                return (
                  <div
                    key={s.__id}
                    className={cn(
                      "relative rounded-lg",
                      draggable && "cursor-grab",
                      isDragging && "opacity-40",
                      isDragOver && "ring-2 ring-destructive",
                    )}
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", s.__id);
                      setDraggedId(s.__id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggable) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverId !== s.__id) setDragOverId(s.__id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === s.__id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId = e.dataTransfer.getData("text/plain");
                      setDraggedId(null);
                      setDragOverId(null);
                      if (sourceId) reorder(sourceId, s.__id);
                    }}
                  >
                    <Button
                      variant="outline"
                      className="w-full h-20 flex flex-col items-center justify-center gap-1 p-2"
                      onClick={() => onPlay(s.__id)}
                    >
                      <span className="text-2xl leading-none">{s.emoji}</span>
                      <span className="text-xs truncate max-w-full">{s.name}</span>
                    </Button>
                    {isAdmin && editMode && (
                      <button
                        type="button"
                        aria-label={`Delete ${s.name}`}
                        onClick={(e) => { e.stopPropagation(); deleteSound(s.__id); }}
                        className="absolute top-1 right-1 p-1 rounded bg-background/80 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isAdmin && editMode && (
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
