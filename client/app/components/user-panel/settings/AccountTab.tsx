import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
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
        <p className="text-xs text-muted-foreground text-center pt-2">v{__APP_VERSION__}</p>
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
