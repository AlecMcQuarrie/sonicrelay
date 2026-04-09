import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, Headphones, HeadphoneOff } from "lucide-react";
import type { ScreenShareSettings } from "~/lib/voice";

// Bitrate targets by resolution and frame rate (must match SCREEN_BITRATES in voice.ts)
const SCREEN_BITRATES: Record<string, number> = {
  '720-30':  2_500_000,
  '720-60':  4_000_000,
  '1080-30': 4_000_000,
  '1080-60': 8_000_000,
  '1440-30': 6_000_000,
  '1440-60': 12_000_000,
};

function formatBitrate(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

const keepOpen = (e: Event) => e.preventDefault();

const DEFAULT_SETTINGS: ScreenShareSettings = {
  resolution: 1080,
  frameRate: 60,
};

function loadSettings(): ScreenShareSettings {
  try {
    const stored = localStorage.getItem('screenshareSettings');
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: ScreenShareSettings) {
  localStorage.setItem('screenshareSettings', JSON.stringify(settings));
}

interface VoiceControlsProps {
  channelName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onStartScreenShare: (settings: ScreenShareSettings) => void;
  onStopScreenShare: () => void;
  onDisconnect: () => void;
}

/*
 * Screenshare settings live in this React component (not in the Electron picker) because:
 * - It works identically in both browser and Electron with zero code duplication
 * - The Electron picker (main.ts) handles *source selection* (which screen/window)
 * - This component handles *quality settings* (resolution, fps, content optimization)
 * - Separation of concerns: source selection is platform-specific, quality settings are universal
 */
export default function VoiceControls({
  channelName, isMuted, isDeafened, isCameraOn, isScreenSharing,
  onToggleMute, onToggleDeafen, onToggleCamera, onStartScreenShare, onStopScreenShare, onDisconnect,
}: VoiceControlsProps) {
  const [settings, setSettings] = useState<ScreenShareSettings>(loadSettings);

  const updateSettings = (update: Partial<ScreenShareSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      saveSettings(next);
      return next;
    });
  };

  return (
    <div className="border-t p-3">
      <div className="text-sm text-muted-foreground mb-2">
        Connected to <span className="font-bold text-foreground">{channelName}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onToggleMute}>
          {isMuted ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleDeafen}>
          {isDeafened ? <HeadphoneOff className="w-4 h-4 text-red-500" /> : <Headphones className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleCamera}>
          {isCameraOn ? <Video className="w-4 h-4 text-red-500" /> : <VideoOff className="w-4 h-4" />}
        </Button>

        {isScreenSharing ? (
          <Button variant="ghost" size="sm" onClick={onStopScreenShare}>
            <ScreenShareOff className="w-4 h-4 text-red-500" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <ScreenShare className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-56">
              <DropdownMenuLabel>Resolution</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(settings.resolution)}
                onValueChange={(v) => updateSettings({ resolution: Number(v) as 720 | 1080 | 1440 })}
              >
                {([720, 1080, 1440] as const).map((res) => (
                  <DropdownMenuRadioItem key={res} value={String(res)} onSelect={keepOpen}>
                    {res}p
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatBitrate(SCREEN_BITRATES[`${res}-${settings.frameRate}`])}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>Frame Rate</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(settings.frameRate)}
                onValueChange={(v) => updateSettings({ frameRate: Number(v) as 30 | 60 })}
              >
                {([30, 60] as const).map((fps) => (
                  <DropdownMenuRadioItem key={fps} value={String(fps)} onSelect={keepOpen}>
                    {fps} FPS
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatBitrate(SCREEN_BITRATES[`${settings.resolution}-${fps}`])}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              <div className="p-1">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => onStartScreenShare(settings)}
                >
                  Start Sharing
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="ghost" size="sm" onClick={onDisconnect}>
          <PhoneOff className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
