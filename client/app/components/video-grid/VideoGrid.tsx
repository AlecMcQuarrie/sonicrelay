import { useEffect, useRef } from "react";

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

export default function VideoGrid({ videoTracks, localUsername }: VideoGridProps) {
  if (videoTracks.size === 0) return null;

  const columns = videoTracks.size === 1 ? 1 : 2;

  return (
    <div
      className="p-2 border-b bg-muted/30 grid gap-2"
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
  );
}
