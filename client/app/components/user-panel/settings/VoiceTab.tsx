import { useEffect, useState, type RefObject } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import InputLevelMeter from "./InputLevelMeter";
import PttKeyCapture from "./PttKeyCapture";
import type { VoiceClient } from "~/lib/voice";
import type { UserSettings } from "~/lib/settings";
import { setSoundboardMasterGain } from "~/lib/soundboard";
import { DB_MIN, DB_MAX, DB_STEP, ampToDb, dbToAmp, formatDb, clampAmpToDbRange } from "~/lib/audio-units";

type Device = { deviceId: string; label: string };
type VadMode = 'off' | 'auto';

interface VoiceTabProps {
  voiceRef: RefObject<VoiceClient | null>;
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

export default function VoiceTab({ voiceRef, settings, updateSettings }: VoiceTabProps) {
  // Device IDs stay local — hardware doesn't transfer across machines.
  const [audioDevices, setAudioDevices] = useState<Device[]>([]);
  const [outputDevices, setOutputDevices] = useState<Device[]>([]);
  const [selectedAudio, setSelectedAudio] = useState(() => localStorage.getItem("preferredAudioDevice") || "");
  const [selectedOutput, setSelectedOutput] = useState(() => localStorage.getItem("preferredOutputDevice") || "");

  useEffect(() => {
    // Ask for mic permission so device labels populate — browsers only expose
    // labels for kinds the user has granted access to.
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); })
      .catch(() => {})
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        setAudioDevices(devices.filter((d) => d.kind === "audioinput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` })));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Speaker (${d.deviceId.slice(0, 8)})` })));
      })
      .catch(() => {});
  }, []);

  const saveAudio = (deviceId: string) => {
    setSelectedAudio(deviceId);
    localStorage.setItem("preferredAudioDevice", deviceId);
    voiceRef.current?.switchAudioDevice(deviceId);
  };

  const saveOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
    localStorage.setItem("preferredOutputDevice", deviceId);
    voiceRef.current?.switchOutputDevice(deviceId);
  };

  const saveMicGain = (value: number) => {
    updateSettings({ micGain: value });
    voiceRef.current?.setMicGain(value);
  };

  const saveSpeakerGain = (value: number) => {
    updateSettings({ speakerGain: value });
    voiceRef.current?.setSpeakerGain(value);
  };

  const saveSoundboardGain = (value: number) => {
    updateSettings({ soundboardGain: value });
    setSoundboardMasterGain(value);
  };

  const saveVadMode = (mode: VadMode) => {
    updateSettings({ vadMode: mode });
    voiceRef.current?.setVadMode(mode);
  };

  const savePttEnabled = (enabled: boolean) => {
    updateSettings({ pttEnabled: enabled });
    voiceRef.current?.setPttEnabled(enabled);
  };

  const saveRnnoiseEnabled = (enabled: boolean) => {
    updateSettings({ rnnoiseEnabled: enabled });
    voiceRef.current?.setRnnoiseEnabled(enabled);
  };

  const savePttKey = (key: string) => {
    updateSettings({ pttKey: key });
    voiceRef.current?.setPttKey(key);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Microphone</label>
        <Select value={selectedAudio || "default"} onValueChange={(v) => saveAudio(v === "default" ? "" : v)}>
          <SelectTrigger className="w-full [&>span]:truncate"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            {audioDevices.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Input Level</label>
        <InputLevelMeter deviceId={selectedAudio} vadMode={settings.vadMode} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Mic Volume</label>
          <span className="text-xs text-muted-foreground tabular-nums">{formatDb(ampToDb(clampAmpToDbRange(settings.micGain)))}</span>
        </div>
        <Slider
          min={DB_MIN}
          max={DB_MAX}
          step={DB_STEP}
          value={[ampToDb(clampAmpToDbRange(settings.micGain))]}
          onValueChange={([db]) => saveMicGain(dbToAmp(db))}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Playback Device</label>
        <Select value={selectedOutput || "default"} onValueChange={(v) => saveOutput(v === "default" ? "" : v)}>
          <SelectTrigger className="w-full [&>span]:truncate"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            {outputDevices.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Speaker Volume</label>
          <span className="text-xs text-muted-foreground tabular-nums">{formatDb(ampToDb(clampAmpToDbRange(settings.speakerGain)))}</span>
        </div>
        <Slider
          min={DB_MIN}
          max={DB_MAX}
          step={DB_STEP}
          value={[ampToDb(clampAmpToDbRange(settings.speakerGain))]}
          onValueChange={([db]) => saveSpeakerGain(dbToAmp(db))}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Soundboard Volume</label>
          <span className="text-xs text-muted-foreground tabular-nums">{formatDb(ampToDb(clampAmpToDbRange(settings.soundboardGain)))}</span>
        </div>
        <Slider
          min={DB_MIN}
          max={DB_MAX}
          step={DB_STEP}
          value={[ampToDb(clampAmpToDbRange(settings.soundboardGain))]}
          onValueChange={([db]) => saveSoundboardGain(dbToAmp(db))}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Noise suppression</label>
          <Switch checked={settings.rnnoiseEnabled} onCheckedChange={saveRnnoiseEnabled} />
        </div>
        <p className="text-xs text-muted-foreground">Removes keyboard, fan, and room noise from your outgoing voice (RNNoise).</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Voice Activity</label>
        <RadioGroup value={settings.vadMode} onValueChange={(v) => saveVadMode(v as VadMode)}>
          <RadioGroupItem value="off">Always on</RadioGroupItem>
          <RadioGroupItem value="auto">Auto (Silero)</RadioGroupItem>
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Push to Talk</label>
          <Switch checked={settings.pttEnabled} onCheckedChange={savePttEnabled} />
        </div>
        {settings.pttEnabled && (
          <PttKeyCapture value={settings.pttKey} onChange={savePttKey} />
        )}
      </div>
    </div>
  );
}
