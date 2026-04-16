import { useEffect, useRef, useState } from "react";
import { Camera, Check, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import PhotoCropModal from "../PhotoCropModal";
import ThemePicker from "./ThemePicker";
import { getProtocol } from "~/lib/protocol";
import type { UserSettings } from "~/lib/settings";

interface AccountTabProps {
  serverIP: string;
  accessToken: string;
  username: string;
  profilePhoto?: string | null;
  onProfilePhotoChange: (url: string) => void;
  nameColor: string | null;
  onNameColorChange: (color: string | null) => void;
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

export default function AccountTab({
  serverIP,
  accessToken,
  username,
  profilePhoto,
  onProfilePhotoChange,
  nameColor,
  onNameColorChange,
  settings,
  updateSettings,
}: AccountTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [localColor, setLocalColor] = useState(nameColor ?? '#00d4ff');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const protocol = getProtocol(serverIP);

  useEffect(() => {
    setLocalColor(nameColor ?? '#00d4ff');
  }, [nameColor]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropImage(URL.createObjectURL(file));
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

  const saveNameColor = (color: string | null) => {
    onNameColorChange(color);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`${protocol}://${serverIP}/me/name-color`, {
        method: 'PUT',
        headers: { "access-token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ nameColor: color }),
      }).catch(() => {});
    }, 300);
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setLocalColor(color);
    saveNameColor(color);
  };

  const resetColor = () => {
    setLocalColor('#00d4ff');
    saveNameColor(null);
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <Avatar username={username} profilePhoto={profilePhoto} size="md" />
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="w-4 h-4 text-white" />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">{username}</div>
            <div className="text-xs text-muted-foreground">Click the avatar to change photo</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Name Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={localColor}
              onChange={handleColorChange}
              className="w-10 h-8 rounded cursor-pointer border border-input bg-transparent"
            />
            <span className="text-sm font-medium" style={{ color: nameColor ?? undefined }}>{username}</span>
            <Button variant="ghost" size="sm" onClick={resetColor} className="ml-auto">Reset</Button>
          </div>
        </div>
        <ThemePicker settings={settings} updateSettings={updateSettings} />
        <UpdateCheck />
      </div>
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

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; releaseUrl: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; filePath: string }
  | { status: "up-to-date" }
  | { status: "error"; message: string };

function UpdateCheck() {
  const api = window.electronAPI;
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (!api) return;
    return api.onDownloadProgress((percent) => {
      setState((prev) =>
        prev.status === "downloading" || prev.status === "available"
          ? { status: "downloading", percent }
          : prev
      );
    });
  }, [api]);

  if (!api) {
    return <p className="text-xs text-muted-foreground text-center pt-2">v{__APP_VERSION__}</p>;
  }

  const check = async () => {
    setState({ status: "checking" });
    try {
      const info = await api.checkForUpdate();
      if (info) {
        setState({ status: "available", version: info.version, releaseUrl: info.releaseUrl });
      } else {
        setState({ status: "up-to-date" });
      }
    } catch {
      setState({ status: "error", message: "Could not check for updates" });
    }
  };

  const download = async () => {
    setState({ status: "downloading", percent: 0 });
    const result = await api.downloadUpdate();
    if (result.success && result.filePath) {
      setState({ status: "ready", filePath: result.filePath });
    } else {
      setState({ status: "error", message: result.error || "Download failed" });
    }
  };

  const install = () => {
    if (state.status === "ready") api.installUpdate(state.filePath);
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
        {(state.status === "idle" || state.status === "up-to-date" || state.status === "error") && (
          <button
            onClick={check}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Check for Updates
          </button>
        )}
        {state.status === "checking" && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking...
          </span>
        )}
      </div>

      {state.status === "up-to-date" && (
        <p className="flex items-center gap-1.5 text-xs text-green-500">
          <Check className="h-3 w-3" />
          You're up to date
        </p>
      )}

      {state.status === "error" && (
        <p className="text-xs text-destructive">{state.message}</p>
      )}

      {state.status === "available" && (
        <div className="flex items-center gap-2 text-xs">
          <span><strong>v{state.version}</strong> available</span>
          <button
            onClick={download}
            className="flex items-center gap-1 rounded bg-primary text-primary-foreground px-2 py-0.5 font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
          <button
            onClick={() => api.openReleasePage(state.releaseUrl)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Notes
          </button>
        </div>
      )}

      {state.status === "downloading" && (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <span className="text-muted-foreground tabular-nums">{state.percent}%</span>
        </div>
      )}

      {state.status === "ready" && (
        <div className="flex items-center gap-2 text-xs">
          <Download className="h-3 w-3 text-green-500 shrink-0" />
          <span>Ready to install</span>
          <button
            onClick={install}
            className="flex items-center gap-1 rounded bg-green-600 text-white px-2 py-0.5 font-medium hover:bg-green-500 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Install & Restart
          </button>
        </div>
      )}
    </div>
  );
}
