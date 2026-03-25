import { useCallback, useEffect, useRef, useState } from "react";

interface VideoGridProps {
  videoTracks: Map<string, MediaStreamTrack>;
  localUsername: string;
}

function VideoTile({ username, track, isLocal }: { username: string; track: MediaStreamTrack; isLocal: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-1 left-2 text-white text-xs bg-black/60 px-1.5 py-0.5 rounded">
        {username}
      </div>
    </div>
  );
}

const MIN_WIDTH = 240;
const MIN_HEIGHT = 180;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 360;

export default function VideoGrid({ videoTracks, localUsername }: VideoGridProps) {
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const dragging = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizing = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag from the title bar area
    e.preventDefault();
    dragging.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
  }, [pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragging.current) {
        const dx = e.clientX - dragging.current.startX;
        const dy = e.clientY - dragging.current.startY;
        setPos({ x: dragging.current.originX + dx, y: dragging.current.originY + dy });
      }
      if (resizing.current) {
        const dx = e.clientX - resizing.current.startX;
        const dy = e.clientY - resizing.current.startY;
        setSize({
          w: Math.max(MIN_WIDTH, resizing.current.originW + dx),
          h: Math.max(MIN_HEIGHT, resizing.current.originH + dy),
        });
      }
    };
    const onMouseUp = () => {
      dragging.current = null;
      resizing.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Resize handler
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { startX: e.clientX, startY: e.clientY, originW: size.w, originH: size.h };
  }, [size]);

  if (videoTracks.size === 0) return null;

  const columns = videoTracks.size === 1 ? 1 : 2;

  return (
    <div
      className="fixed z-50 rounded-lg border bg-background shadow-lg flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Drag handle */}
      <div
        className="h-7 bg-muted flex items-center px-2 cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onDragStart}
      >
        <span className="text-xs text-muted-foreground font-medium select-none">
          Video — {videoTracks.size} {videoTracks.size === 1 ? "camera" : "cameras"}
        </span>
      </div>

      {/* Video tiles */}
      <div
        className="flex-1 min-h-0 grid gap-1 p-1"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {[...videoTracks.entries()].map(([username, track]) => (
          <VideoTile
            key={username}
            username={username}
            track={track}
            isLocal={username === localUsername}
          />
        ))}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
