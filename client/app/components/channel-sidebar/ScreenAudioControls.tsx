import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

type VoicePeerSetting = {
  volume: number;
  muted: boolean;
};

interface ScreenAudioControlsProps {
  username: string;
  setting: VoicePeerSetting;
  disabled?: boolean;
  onVolume: (username: string, volume: number) => void;
  onMute: (username: string, muted: boolean) => void;
}

export default function ScreenAudioControls({ username, setting, disabled, onVolume, onMute }: ScreenAudioControlsProps) {
  const [muted, setMuted] = useState(setting.muted);
  const [volume, setVolume] = useState(setting.volume);

  return (
    <div className="p-2 space-y-2 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-medium">Screen Audio</div>
      <div className="flex items-center gap-2">
        <button
          className="shrink-0 p-0.5 rounded hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
          disabled={disabled}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onMute(username, next);
          }}
        >
          {muted
            ? <VolumeX className="w-3.5 h-3.5 text-red-500" />
            : <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={volume}
          disabled={disabled}
          className="w-full h-1 accent-foreground disabled:opacity-50"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            onVolume(username, v);
          }}
        />
      </div>
    </div>
  );
}
