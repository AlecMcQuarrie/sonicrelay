import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Button } from "~/components/ui/button";
import { MousePointer, X } from "lucide-react";
import type { RemoteControlInputEvent } from "~/lib/remoteControl";

interface FocusedVideoProps {
  videoTracks: Map<string, MediaStreamTrack>;
  onRemove: (username: string) => void;
  onCloseAll: () => void;
  // Viewer-side remote control: which screen-sharer's feed (if any) the local
  // user is currently controlling, plus the callbacks to forward input and
  // release. Optional — the web client omits these entirely.
  controlledKey?: string | null;
  localUsername?: string;
  onSendInput?: (event: RemoteControlInputEvent) => void;
  onReleaseControl?: () => void;
  onRequestControl?: (sharerUsername: string) => void;
}

function parseLabel(key: string): string {
  const [source, ...rest] = key.split(':');
  const user = rest.join(':');
  if (source === 'screen') return `${user} (screen)`;
  return user;
}

function VideoTile({
  videoKey, track, onRemove, isControlling, localUsername, onSendInput, onReleaseControl, onRequestControl,
}: {
  videoKey: string;
  track: MediaStreamTrack;
  onRemove: () => void;
  isControlling: boolean;
  localUsername?: string;
  onSendInput?: (event: RemoteControlInputEvent) => void;
  onReleaseControl?: () => void;
  onRequestControl?: (sharerUsername: string) => void;
}) {
  const [source, ...rest] = videoKey.split(':');
  const sourceUsername = rest.join(':');
  const canRequestControl =
    !isControlling
    && source === 'screen'
    && sourceUsername !== localUsername
    && !!onRequestControl
    && !!window.electronAPI;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  // Translate pointer coordinates into 0..1 relative to the rendered video.
  const normalize = useCallback((clientX: number, clientY: number) => {
    const el = videoRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  // Forward keyboard while the tile has focus. Uses capture so it beats the
  // browser's default handling, and calls preventDefault so browser shortcuts
  // (Ctrl+W, etc.) don't close the app when the user means to send them to
  // the controlled machine.
  useEffect(() => {
    if (!isControlling || !onSendInput) return;
    const el = containerRef.current;
    if (!el) return;

    const onKey = (evt: KeyboardEvent) => {
      if (document.activeElement !== el) return;
      if (evt.key === 'Escape') {
        evt.preventDefault();
        onReleaseControl?.();
        return;
      }
      evt.preventDefault();
      onSendInput({ kind: evt.type === 'keydown' ? 'key-down' : 'key-up', code: evt.code });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [isControlling, onSendInput, onReleaseControl]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  const handlePointerMove = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !onSendInput) return;
    const norm = normalize(evt.clientX, evt.clientY);
    if (!norm) return;
    pendingMoveRef.current = norm;
    if (moveRafRef.current !== null) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;
      const pending = pendingMoveRef.current;
      if (pending) onSendInput({ kind: 'mouse-move', x: pending.x, y: pending.y });
    });
  };

  const handlePointerDown = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !onSendInput) return;
    containerRef.current?.focus();
    const button = evt.button === 2 ? 'right' : evt.button === 1 ? 'middle' : 'left';
    onSendInput({ kind: 'mouse-down', button });
  };

  const handlePointerUp = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (!isControlling || !onSendInput) return;
    const button = evt.button === 2 ? 'right' : evt.button === 1 ? 'middle' : 'left';
    onSendInput({ kind: 'mouse-up', button });
  };

  const handleWheel = (evt: ReactWheelEvent<HTMLDivElement>) => {
    if (!isControlling || !onSendInput) return;
    // Use deltaMode-normalized step; clamp so a single big scroll doesn't spam.
    const scale = evt.deltaMode === 1 ? 1 : 0.05;  // line vs pixel mode
    onSendInput({
      kind: 'wheel',
      dx: Math.max(-50, Math.min(50, evt.deltaX * scale)),
      dy: Math.max(-50, Math.min(50, evt.deltaY * scale)),
    });
  };

  const handleContextMenu = (evt: React.MouseEvent<HTMLDivElement>) => {
    if (!isControlling) return;
    evt.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      tabIndex={isControlling ? 0 : -1}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className={`relative bg-black rounded-lg overflow-hidden aspect-video outline-none ${
        isControlling ? 'ring-2 ring-primary cursor-crosshair focus:ring-4' : ''
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute bottom-1 left-2 text-white text-xs bg-black/60 px-1.5 py-0.5 rounded">
        {parseLabel(videoKey)}
      </div>
      {isControlling && (
        <div className="absolute top-1 left-1 flex items-center gap-1 text-[10px] text-white bg-primary/80 px-1.5 py-0.5 rounded">
          <MousePointer className="w-3 h-3" />
          Controlling — click to focus keyboard, Esc to release
        </div>
      )}
      <div className="absolute top-1 right-1 flex items-center gap-1">
        {canRequestControl && (
          <button
            className="h-5 px-1.5 flex items-center gap-1 rounded bg-black/60 text-white text-[10px] hover:bg-primary hover:text-primary-foreground"
            onClick={(e) => { e.stopPropagation(); onRequestControl?.(sourceUsername); }}
            aria-label={`Request control of ${sourceUsername}'s screen`}
          >
            <MousePointer className="w-3 h-3" />
            Request control
          </button>
        )}
        <button
          className="w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Remove ${parseLabel(videoKey)}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function FocusedVideo({
  videoTracks, onRemove, onCloseAll, controlledKey, localUsername, onSendInput, onReleaseControl, onRequestControl,
}: FocusedVideoProps) {
  const count = videoTracks.size;
  const columns = count <= 1 ? 1 : 2;

  return (
    <div className="absolute top-1 left-0 right-0 bottom-0 z-10 bg-background/95 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium">
          {count} {count === 1 ? "feed" : "feeds"}
        </span>
        <Button variant="ghost" size="sm" onClick={onCloseAll} aria-label="Close all feeds">
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div
        className="flex-1 min-h-0 grid gap-2 p-4 place-content-center"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {[...videoTracks.entries()].map(([key, track]) => (
          <VideoTile
            key={key}
            videoKey={key}
            track={track}
            onRemove={() => onRemove(key)}
            isControlling={controlledKey === key}
            localUsername={localUsername}
            onSendInput={onSendInput}
            onReleaseControl={onReleaseControl}
            onRequestControl={onRequestControl}
          />
        ))}
      </div>
    </div>
  );
}
