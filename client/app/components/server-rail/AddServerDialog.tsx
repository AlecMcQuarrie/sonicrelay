import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import ServerJoinForm from "~/components/server-join/ServerJoinForm";
import { joinServer } from "~/lib/auth";
import { useConnectionManager } from "~/lib/connectionManager";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddServerDialog({ open, onOpenChange }: AddServerDialogProps) {
  const { addConnection } = useConnectionManager();
  // Force remount of the form when the dialog is opened so previous
  // state/errors don't leak between sessions.
  const [instance, setInstance] = useState(0);

  const handleSubmit = async (args: {
    serverIP: string;
    username: string;
    password: string;
    isRegistration: boolean;
  }) => {
    const { connection, privateKey } = await joinServer(args);
    addConnection(connection, privateKey);
    onOpenChange(false);
    setInstance((n) => n + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Server</DialogTitle>
        </DialogHeader>
        <ServerJoinForm key={instance} submitForm={handleSubmit} />
      </DialogContent>
    </Dialog>
  );
}
