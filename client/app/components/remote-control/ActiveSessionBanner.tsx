import { ShieldAlert, MousePointer, Square } from "lucide-react";
import type { RemoteControlSession } from "~/lib/remoteControl";

interface ActiveSessionBannerProps {
  session: RemoteControlSession | null;
  onStop: () => void;
}

export default function ActiveSessionBanner({ session, onStop }: ActiveSessionBannerProps) {
  if (!session) return null;

  if (session.role === 'sharer') {
    return (
      <div className="flex items-center gap-3 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm">
        <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
        <span>
          <strong>{session.controllerUsername}</strong> is controlling your screen
        </span>
        <button
          onClick={onStop}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-destructive text-destructive-foreground px-3 py-1 text-xs font-medium hover:bg-destructive/90 transition-colors"
        >
          <Square className="h-3 w-3" />
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-primary/10 border-b border-primary/20 px-4 py-2 text-sm">
      <MousePointer className="h-4 w-4 text-primary shrink-0" />
      <span>
        Controlling <strong>{session.sharerUsername}</strong>'s screen — press Esc to release
      </span>
      <button
        onClick={onStop}
        className="ml-auto flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium hover:bg-primary/90 transition-colors"
      >
        <Square className="h-3 w-3" />
        Release
      </button>
    </div>
  );
}
