import { useState } from "react";
import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { deriveWrappingKey, unwrapPrivateKey, base64ToArrayBuffer } from "~/lib/crypto";

interface UnlockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encryptedPrivateKey: string;
  pbkdfSalt: string;
  onUnlocked: (privateKey: CryptoKey) => void;
}

export default function UnlockModal({ open, onOpenChange, encryptedPrivateKey, pbkdfSalt, onUnlocked }: UnlockModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  async function handleUnlock() {
    if (!password) return;
    setError(null);
    setUnlocking(true);

    try {
      const salt = new Uint8Array(base64ToArrayBuffer(pbkdfSalt));
      const wrappingKey = await deriveWrappingKey(password, salt);
      const privateKey = await unwrapPrivateKey(encryptedPrivateKey, wrappingKey);
      setPassword("");
      onUnlocked(privateKey);
      onOpenChange(false);
    } catch {
      setError("Incorrect password");
    } finally {
      setUnlocking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUnlock();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Unlock Direct Messages
          </DialogTitle>
          <DialogDescription>
            Enter your password to decrypt your private key and access direct messages.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="unlock-password">Password</Label>
          <Input
            id="unlock-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your account password"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleUnlock} disabled={!password || unlocking}>
            {unlocking ? "Unlocking..." : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
