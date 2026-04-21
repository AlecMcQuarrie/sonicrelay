import { useState, type RefObject } from "react";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import EqSpectrumCanvas from "./EqSpectrumCanvas";
import type { VoiceClient } from "~/lib/voice";
import {
  DEFAULT_EQ_BANDS,
  EQ_BAND_LABELS,
  type EqBand,
  type UserSettings,
} from "~/lib/settings";

interface EqTabProps {
  voiceRef: RefObject<VoiceClient | null>;
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

// Indices of peaking bands — only these expose a Q control. Shelves ignore Q
// in a user-meaningful way, so we don't expose it for them.
const PEAKING_INDICES = [1, 2, 3];

export default function EqTab({ voiceRef, settings, updateSettings }: EqTabProps) {
  // Device IDs are per-machine, not cross-device, so we read them locally.
  const [deviceId] = useState(() => localStorage.getItem("preferredAudioDevice") || "");

  const updateBand = (index: number, patch: Partial<EqBand>) => {
    const next = settings.micEqBands.map((b, i) => i === index ? { ...b, ...patch } : b);
    updateSettings({ micEqBands: next });
    const band = next[index];
    voiceRef.current?.setEqBand(index, band.gain, band.q);
  };

  const toggleEnabled = (enabled: boolean) => {
    updateSettings({ micEqEnabled: enabled });
    voiceRef.current?.setMicEqEnabled(enabled);
  };

  const reset = () => {
    const flat = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
    updateSettings({ micEqBands: flat });
    flat.forEach((b, i) => voiceRef.current?.setEqBand(i, b.gain, b.q));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Microphone EQ</label>
          <p className="text-xs text-muted-foreground">Shape how your mic sounds to others.</p>
        </div>
        <Switch checked={settings.micEqEnabled} onCheckedChange={toggleEnabled} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Live spectrum</label>
        <EqSpectrumCanvas
          deviceId={deviceId}
          bands={settings.micEqBands}
          enabled={settings.micEqEnabled}
        />
        <p className="text-xs text-muted-foreground">
          Bars show your live input. Line shows the EQ curve.
        </p>
      </div>

      <div className="flex items-end justify-between gap-3">
        {settings.micEqBands.map((band, i) => (
          <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <span className="text-xs tabular-nums text-muted-foreground">
              {band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)} dB
            </span>
            <Slider
              orientation="vertical"
              min={-12}
              max={12}
              step={0.5}
              value={[band.gain]}
              onValueChange={([v]) => updateBand(i, { gain: v })}
              disabled={!settings.micEqEnabled}
              className="h-32"
            />
            <span className="text-xs font-medium">{EQ_BAND_LABELS[i]}</span>
            {PEAKING_INDICES.includes(i) ? (
              <div className="w-full space-y-1">
                <Slider
                  min={30}
                  max={300}
                  step={5}
                  value={[Math.round(band.q * 100)]}
                  onValueChange={([v]) => updateBand(i, { q: v / 100 })}
                  disabled={!settings.micEqEnabled}
                />
                <div className="text-[10px] text-center text-muted-foreground tabular-nums">
                  Q {band.q.toFixed(2)}
                </div>
              </div>
            ) : (
              <div className="h-[38px]" />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={reset}>Reset to flat</Button>
      </div>
    </div>
  );
}
