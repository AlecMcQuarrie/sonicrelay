import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface BanDialogProps {
  username: string | null;
  onClose: () => void;
  onConfirm: (username: string) => void;
}

export default function BanDialog({ username, onClose, onConfirm }: BanDialogProps) {
  return (
    <Dialog open={username !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban {username}?</DialogTitle>
          <DialogDescription>
            They will be disconnected immediately and blocked from logging in again. Their past messages will remain.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (username) onConfirm(username);
              onClose();
            }}
          >
            Ban user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
