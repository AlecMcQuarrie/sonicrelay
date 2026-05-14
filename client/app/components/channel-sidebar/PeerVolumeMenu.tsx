import { useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { DB_MIN, DB_MAX, DB_STEP, ampToDb, dbToAmp, formatDb, clampAmpToDbRange } from "~/lib/audio-units";

type VoicePeerSetting = {
  volume: number;
  muted: boolean;
};

interface PeerVolumeMenuProps {
  username: string;
  setting: VoicePeerSetting;
  hideTitle?: boolean;
  onVolume: (username: string, volume: number) => void;
  onMute: (username: string, muted: boolean) => void;
}

export default function PeerVolumeMenu({ username, setting, hideTitle, onVolume, onMute }: PeerVolumeMenuProps) {
  const [volumeDb, setVolumeDb] = useState(ampToDb(clampAmpToDbRange(setting.volume)));
  const [muted, setMuted] = useState(setting.muted);

  return (
    <div className="p-2 space-y-2 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
      {!hideTitle && <div className="text-xs font-medium truncate">{username}</div>}
      <div className="flex items-center gap-2">
        <button
          className="shrink-0 p-0.5 rounded hover:bg-muted"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onMute(username, next);
          }}
        >
          {muted
            ? <MicOff className="w-3.5 h-3.5 text-red-500" />
            : <Mic className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
        <input
          type="range"
          min={DB_MIN}
          max={DB_MAX}
          step={DB_STEP}
          value={volumeDb}
          className="w-full h-1 accent-foreground"
          onChange={(e) => {
            const db = parseFloat(e.target.value);
            setVolumeDb(db);
            onVolume(username, dbToAmp(db));
          }}
        />
        <span className="text-[10px] text-muted-foreground tabular-nums min-w-[52px] text-right shrink-0">
          {formatDb(volumeDb)}
        </span>
      </div>
    </div>
  );
}
