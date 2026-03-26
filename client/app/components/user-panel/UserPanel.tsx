import { useState } from "react";
import { Settings } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import SettingsModal from "./SettingsModal";

interface UserPanelProps {
  username: string;
  serverIP: string;
  profilePhoto?: string | null;
  accessToken: string;
  onProfilePhotoChange: (url: string) => void;
}

export default function UserPanel({ username, serverIP, profilePhoto, accessToken, onProfilePhotoChange }: UserPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
  const photoUrl = profilePhoto ? `${protocol}://${serverIP}${profilePhoto}` : null;

  return (
    <>
      <div className="border-t p-3 flex items-center gap-2">
        <Avatar username={username} profilePhoto={photoUrl} />
        <span className="text-sm font-medium truncate flex-1">{username}</span>
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
        profilePhoto={photoUrl}
        onProfilePhotoChange={onProfilePhotoChange}
      />
    </>
  );
}
