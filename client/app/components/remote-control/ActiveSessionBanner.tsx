import { Square } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { RemoteControlSession } from "~/lib/remoteControl";

interface ActiveSessionBannerProps {
  session: RemoteControlSession | null;
  // True while the sharer's takeover safeguard has paused injection mid-
  // session. The session is otherwise still active.
  paused: boolean;
  onStop: () => void;
}

export default function ActiveSessionBanner({ session, paused, onStop }: ActiveSessionBannerProps) {
  if (!session) return null;

  const isSharer = session.role === 'sharer';

  // Color tone: paused → amber/warning. Active sharer → destructive (your
  // screen). Active controller → primary (you're driving).
  const tone = paused ? 'warning' : isSharer ? 'destructive' : 'primary';

  const containerByTone = {
    warning: 'border-b border-amber-500/40 bg-amber-500/10',
    destructive: 'border-b border-destructive/40 bg-destructive/10',
    primary: 'border-b border-primary/30 bg-primary/10',
  }[tone];

  const dotByTone = {
    warning: 'bg-amber-500',
    destructive: 'bg-destructive',
    primary: 'bg-primary',
  }[tone];

  const textByTone = {
    warning: 'text-amber-700 dark:text-amber-400',
    destructive: 'text-destructive',
    primary: 'text-primary',
  }[tone];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-sm ${containerByTone}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotByTone}`} />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotByTone}`} />
      </span>

      <span className={textByTone}>
        {paused ? (
          isSharer ? (
            <>You're back in control — <strong className="font-semibold">{session.controllerUsername}</strong> paused</>
          ) : (
            <><strong className="font-semibold">{session.sharerUsername}</strong> took back control — your input paused</>
          )
        ) : isSharer ? (
          <><strong className="font-semibold">{session.controllerUsername}</strong> is controlling your screen</>
        ) : (
          <>Controlling <strong className="font-semibold">{session.sharerUsername}</strong>'s screen — press Esc to release</>
        )}
      </span>

      <Button
        variant={isSharer ? "destructive" : "default"}
        size="xs"
        onClick={onStop}
        className="ml-auto"
      >
        <Square />
        {isSharer ? "Stop" : "Release"}
      </Button>
    </div>
  );
}
