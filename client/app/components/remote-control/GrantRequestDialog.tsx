import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface GrantRequestDialogProps {
  requesterUsername: string | null;
  onClose: () => void;
  onDecide: (requesterUsername: string, granted: boolean) => void;
}

export default function GrantRequestDialog({ requesterUsername, onClose, onDecide }: GrantRequestDialogProps) {
  return (
    <Dialog open={requesterUsername !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requesterUsername} wants to control your screen</DialogTitle>
          <DialogDescription>
            They will be able to move your mouse and type on your keyboard until you end the session. You can stop at any time from the banner at the top of the window.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { if (requesterUsername) onDecide(requesterUsername, false); onClose(); }}
          >
            Deny
          </Button>
          <Button
            variant="destructive"
            onClick={() => { if (requesterUsername) onDecide(requesterUsername, true); onClose(); }}
          >
            Allow control
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
