import { useState, type RefObject } from "react";
import { Settings } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import SettingsModal from "./SettingsModal";
import { buildUploadUrl } from "~/lib/protocol";
import type { VoiceClient } from "~/lib/voice";
import type { UserSettings } from "~/lib/settings";

type Role = 'superadmin' | 'admin' | 'member';

interface UserPanelProps {
  username: string;
  serverIP: string;
  profilePhoto?: string | null;
  accessToken: string;
  uploadToken: string | null;
  onProfilePhotoChange: (url: string) => void;
  nameColor: string | null;
  onNameColorChange: (color: string | null) => void;
  myRole: Role;
  totalUsers: number;
  onlineCount: number;
  textChannelCount: number;
  voiceChannelCount: number;
  onLogout: () => void;
  voiceRef: RefObject<VoiceClient | null>;
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

export default function UserPanel({
  username,
  serverIP,
  profilePhoto,
  accessToken,
  uploadToken,
  onProfilePhotoChange,
  nameColor,
  onNameColorChange,
  myRole,
  totalUsers,
  onlineCount,
  textChannelCount,
  voiceChannelCount,
  onLogout,
  voiceRef,
  settings,
  updateSettings,
}: UserPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const photoUrl = profilePhoto && uploadToken ? buildUploadUrl(profilePhoto, serverIP, uploadToken) : null;

  return (
    <>
      <div className="border-t p-3 flex items-center gap-2">
        <Avatar username={username} profilePhoto={photoUrl} />
        <span className="text-sm font-medium truncate flex-1" style={nameColor ? { color: nameColor } : undefined}>{username}</span>
        <button
          onClick={() => setSettingsOpen(true)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        serverIP={serverIP}
        accessToken={accessToken}
        username={username}
        profilePhoto={photoUrl}
        onProfilePhotoChange={onProfilePhotoChange}
        nameColor={nameColor}
        onNameColorChange={onNameColorChange}
        myRole={myRole}
        totalUsers={totalUsers}
        onlineCount={onlineCount}
        textChannelCount={textChannelCount}
        voiceChannelCount={voiceChannelCount}
        voiceRef={voiceRef}
        onLogout={onLogout}
        settings={settings}
        updateSettings={updateSettings}
      />
    </>
  );
}
