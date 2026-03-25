import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";

interface FocusedVideoProps {
  username: string;
  track: MediaStreamTrack;
  onClose: () => void;
}

export default function FocusedVideo({ username, track, onClose }: FocusedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  return (
    <div className="absolute inset-0 z-10 bg-background/95 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium">{username}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        <div className="aspect-video max-w-full max-h-full w-full bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}
