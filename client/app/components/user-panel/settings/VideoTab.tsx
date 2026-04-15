import { useEffect, useState, type RefObject } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import CameraPreview from "./CameraPreview";
import type { VoiceClient } from "~/lib/voice";

type Device = { deviceId: string; label: string };

interface VideoTabProps {
  voiceRef: RefObject<VoiceClient | null>;
}

export default function VideoTab({ voiceRef }: VideoTabProps) {
  const [videoDevices, setVideoDevices] = useState<Device[]>([]);
  const [selectedVideo, setSelectedVideo] = useState(() => localStorage.getItem("preferredVideoDevice") || "");

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); })
      .catch(() => {})
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        setVideoDevices(devices.filter((d) => d.kind === "videoinput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera (${d.deviceId.slice(0, 8)})` })));
      })
      .catch(() => {});
  }, []);

  const saveVideo = (deviceId: string) => {
    setSelectedVideo(deviceId);
    localStorage.setItem("preferredVideoDevice", deviceId);
    voiceRef.current?.switchVideoDevice(deviceId);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Camera</label>
        <Select value={selectedVideo || "default"} onValueChange={(v) => saveVideo(v === "default" ? "" : v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            {videoDevices.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Preview</label>
        <CameraPreview deviceId={selectedVideo} />
      </div>
    </div>
  );
}
