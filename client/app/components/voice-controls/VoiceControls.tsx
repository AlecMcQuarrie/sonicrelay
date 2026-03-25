import { Button } from "~/components/ui/button";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

interface VoiceControlsProps {
  channelName: string;
  isMuted: boolean;
  isCameraOn: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onDisconnect: () => void;
}

export default function VoiceControls({
  channelName, isMuted, isCameraOn, onToggleMute, onToggleCamera, onDisconnect,
}: VoiceControlsProps) {
  return (
    <div className="border-t p-3">
      <div className="text-sm text-muted-foreground mb-2">
        Connected to <span className="font-bold text-foreground">{channelName}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onToggleMute}>
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleCamera}>
          {isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDisconnect}>
          <PhoneOff className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
