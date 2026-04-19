import { useEffect, useState, type RefObject } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import InputLevelMeter from "./InputLevelMeter";
import PttKeyCapture from "./PttKeyCapture";
import type { VoiceClient } from "~/lib/voice";
import type { UserSettings } from "~/lib/settings";

type Device = { deviceId: string; label: string };
type VadMode = 'off' | 'auto' | 'manual';

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

  const saveVadMode = (mode: VadMode) => {
    updateSettings({ vadMode: mode });
    voiceRef.current?.setVadMode(mode);
  };

  const saveVadThreshold = (value: number) => {
    updateSettings({ vadThreshold: value });
    voiceRef.current?.setVadThreshold(value);
  };

  const savePttEnabled = (enabled: boolean) => {
    updateSettings({ pttEnabled: enabled });
    voiceRef.current?.setPttEnabled(enabled);
  };

  const saveNormalizeVoices = (enabled: boolean) => {
    updateSettings({ normalizeVoices: enabled });
    voiceRef.current?.setNormalizeVoices(enabled);
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
        <InputLevelMeter
          deviceId={selectedAudio}
          vadMode={settings.vadMode}
          vadThreshold={settings.vadThreshold}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Mic Volume</label>
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round(settings.micGain * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={200}
          step={1}
          value={[Math.round(settings.micGain * 100)]}
          onValueChange={([v]) => saveMicGain(v / 100)}
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
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round(settings.speakerGain * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={200}
          step={1}
          value={[Math.round(settings.speakerGain * 100)]}
          onValueChange={([v]) => saveSpeakerGain(v / 100)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Normalize voices</label>
          <Switch checked={settings.normalizeVoices} onCheckedChange={saveNormalizeVoices} />
        </div>
        <p className="text-xs text-muted-foreground">Auto-level quiet and loud speakers.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Voice Activity</label>
        <RadioGroup value={settings.vadMode} onValueChange={(v) => saveVadMode(v as VadMode)}>
          <RadioGroupItem value="off">Always on</RadioGroupItem>
          <RadioGroupItem value="auto">Auto</RadioGroupItem>
          <RadioGroupItem value="manual">Manual</RadioGroupItem>
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">VAD Threshold</label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {settings.vadMode === 'manual' ? Math.round(settings.vadThreshold) : settings.vadMode}
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[settings.vadThreshold]}
          disabled={settings.vadMode !== 'manual'}
          onValueChange={([v]) => saveVadThreshold(v)}
        />
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
