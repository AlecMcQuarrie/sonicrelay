import { useState, type RefObject } from "react";
import { Settings } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import SettingsModal from "./SettingsModal";
import { buildUploadUrl } from "~/lib/protocol";
import type { VoiceClient } from "~/lib/voice";

interface UserPanelProps {
  username: string;
  serverIP: string;
  profilePhoto?: string | null;
  accessToken: string;
  onProfilePhotoChange: (url: string) => void;
  voiceRef: RefObject<VoiceClient | null>;
}

export default function UserPanel({ username, serverIP, profilePhoto, accessToken, onProfilePhotoChange, voiceRef }: UserPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const photoUrl = profilePhoto ? buildUploadUrl(profilePhoto, serverIP, accessToken) : null;

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
        voiceRef={voiceRef}
      />
    </>
  );
}
