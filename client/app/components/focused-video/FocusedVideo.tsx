import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";

interface FocusedVideoProps {
  videoTracks: Map<string, MediaStreamTrack>;
  onRemove: (username: string) => void;
  onCloseAll: () => void;
}

function parseLabel(key: string): string {
  const [source, ...rest] = key.split(':');
  const user = rest.join(':');
  if (source === 'screen') return `${user} (screen)`;
  return user;
}

function VideoTile({ username, track, onRemove }: { username: string; track: MediaStreamTrack; onRemove: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-1 left-2 text-white text-xs bg-black/60 px-1.5 py-0.5 rounded">
        {parseLabel(username)}
      </div>
      <button
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
        onClick={onRemove}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function FocusedVideo({ videoTracks, onRemove, onCloseAll }: FocusedVideoProps) {
  const count = videoTracks.size;
  const columns = count <= 1 ? 1 : 2;

  return (
    <div className="absolute top-1 left-0 right-0 bottom-0 z-10 bg-background/95 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium">
          {count} {count === 1 ? "feed" : "feeds"}
        </span>
        <Button variant="ghost" size="sm" onClick={onCloseAll}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div
        className="flex-1 min-h-0 grid gap-2 p-4 place-content-center"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {[...videoTracks.entries()].map(([username, track]) => (
          <VideoTile
            key={username}
            username={username}
            track={track}
            onRemove={() => onRemove(username)}
          />
        ))}
      </div>
    </div>
  );
}
