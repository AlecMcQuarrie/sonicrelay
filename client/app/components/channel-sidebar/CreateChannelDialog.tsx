import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Hash, Volume2 } from "lucide-react";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType: "text" | "voice";
  onCreateChannel: (name: string, type: "text" | "voice") => void;
}

export default function CreateChannelDialog({
  open, onOpenChange, defaultType, onCreateChannel,
}: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">(defaultType);

  // Reset form when dialog opens with the pre-selected type
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName("");
      setType(defaultType);
    }
    onOpenChange(next);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreateChannel(name.trim(), type);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Button
              variant={type === "text" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setType("text")}
            >
              <Hash className="w-4 h-4 mr-1" />
              Text
            </Button>
            <Button
              variant={type === "voice" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setType("voice")}
            >
              <Volume2 className="w-4 h-4 mr-1" />
              Voice
            </Button>
          </div>

          <Input
            placeholder="Channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={handleCreate}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
