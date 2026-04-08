import { useEffect, useRef, useState, type RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Camera } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import PhotoCropModal from "./PhotoCropModal";
import type { VoiceClient } from "~/lib/voice";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverIP: string;
  accessToken: string;
  profilePhoto?: string | null;
  onProfilePhotoChange: (url: string) => void;
  voiceRef: RefObject<VoiceClient | null>;
}

type MediaDeviceOption = { deviceId: string; label: string };

export default function SettingsModal({ open, onOpenChange, serverIP, accessToken, profilePhoto, onProfilePhotoChange, voiceRef }: SettingsModalProps) {
  const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceOption[]>([]);
  const [selectedAudio, setSelectedAudio] = useState(() => localStorage.getItem("preferredAudioDevice") || "");
  const [selectedVideo, setSelectedVideo] = useState(() => localStorage.getItem("preferredVideoDevice") || "");
  const [selectedOutput, setSelectedOutput] = useState(() => localStorage.getItem("preferredOutputDevice") || "");
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  useEffect(() => {
    if (!open) return;
    // Request audio and video permissions separately so one failing doesn't block the other.
    // Browsers only expose device labels for media kinds you've been granted permission for.
    const requests = [
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); }).catch(() => {}),
      navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); }).catch(() => {}),
    ];
    Promise.all(requests)
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        setAudioDevices(devices.filter((d) => d.kind === "audioinput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` })));
        setVideoDevices(devices.filter((d) => d.kind === "videoinput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera (${d.deviceId.slice(0, 8)})` })));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput" && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label || `Speaker (${d.deviceId.slice(0, 8)})` })));
      })
      .catch(() => {});
  }, [open]);

  const saveAudio = (deviceId: string) => {
    setSelectedAudio(deviceId);
    localStorage.setItem("preferredAudioDevice", deviceId);
    voiceRef.current?.switchAudioDevice(deviceId);
  };

  const saveVideo = (deviceId: string) => {
    setSelectedVideo(deviceId);
    localStorage.setItem("preferredVideoDevice", deviceId);
    voiceRef.current?.switchVideoDevice(deviceId);
  };

  const saveOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
    localStorage.setItem("preferredOutputDevice", deviceId);
    voiceRef.current?.switchOutputDevice(deviceId);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCropImage(url);
    e.target.value = "";
  };

  const uploadCroppedPhoto = async (blob: Blob) => {
    const formData = new FormData();
    formData.append('file', blob, 'profile.jpg');
    const res = await fetch(`${protocol}://${serverIP}/me/profile-photo`, {
      method: 'PUT',
      headers: { "access-token": accessToken },
      body: formData,
    });
    const data = await res.json();
    onProfilePhotoChange(data.profilePhoto);
    setCropImage(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <Avatar username="" profilePhoto={profilePhoto} size="md" />
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-4 h-4 text-white" />
                </div>
              </div>
              <span className="text-sm text-muted-foreground">Click to change photo</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Microphone</label>
              <select
                value={selectedAudio}
                onChange={(e) => saveAudio(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Default</option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Playback Device</label>
              <select
                value={selectedOutput}
                onChange={(e) => saveOutput(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Default</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Camera</label>
              <select
                value={selectedVideo}
                onChange={(e) => saveVideo(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Default</option>
                {videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-2">v{__APP_VERSION__}</p>
          </div>
        </DialogContent>
      </Dialog>
      {cropImage && (
        <PhotoCropModal
          open={!!cropImage}
          onOpenChange={(open) => { if (!open) setCropImage(null); }}
          imageSrc={cropImage}
          onCropComplete={uploadCroppedPhoto}
        />
      )}
    </>
  );
}
