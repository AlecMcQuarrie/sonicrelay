import { Button } from "~/components/ui/button";
import { Mic, MicOff, PhoneOff } from "lucide-react";

interface VoiceControlsProps {
  channelName: string;
  isMuted: boolean;
  isSpeaking: boolean;
  onToggleMute: () => void;
  onDisconnect: () => void;
}

export default function VoiceControls({ channelName, isMuted, isSpeaking, onToggleMute, onDisconnect }: VoiceControlsProps) {
  return (
    <div className={`border-t p-3 transition-colors ${isSpeaking && !isMuted ? "border-green-400/50" : ""}`}>
      <div className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full transition-colors ${
            isSpeaking && !isMuted ? "bg-green-400" : "bg-muted-foreground/40"
          }`}
        />
        Connected to <span className="font-bold text-foreground">{channelName}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onToggleMute}>
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDisconnect}>
          <PhoneOff className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
