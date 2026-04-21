import { type RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import AccountTab from "./settings/AccountTab";
import VoiceTab from "./settings/VoiceTab";
import EqTab from "./settings/EqTab";
import VideoTab from "./settings/VideoTab";
import AdminTab from "./settings/AdminTab";
import LogoutTab from "./settings/LogoutTab";
import type { VoiceClient } from "~/lib/voice";
import type { UserSettings } from "~/lib/settings";

type Role = 'superadmin' | 'admin' | 'member';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverIP: string;
  accessToken: string;
  username: string;
  profilePhoto?: string | null;
  onProfilePhotoChange: (url: string) => void;
  nameColor: string | null;
  onNameColorChange: (color: string | null) => void;
  myRole: Role;
  totalUsers: number;
  onlineCount: number;
  textChannelCount: number;
  voiceChannelCount: number;
  voiceRef: RefObject<VoiceClient | null>;
  onLogout: () => void;
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

export default function SettingsModal({
  open,
  onOpenChange,
  serverIP,
  accessToken,
  username,
  profilePhoto,
  onProfilePhotoChange,
  nameColor,
  onNameColorChange,
  myRole,
  totalUsers,
  onlineCount,
  textChannelCount,
  voiceChannelCount,
  voiceRef,
  onLogout,
  settings,
  updateSettings,
}: SettingsModalProps) {
  const isAdmin = myRole === 'admin' || myRole === 'superadmin';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="account" orientation="vertical" className="px-4 pb-4 gap-4">
          <TabsList className="w-32 shrink-0">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="eq">Mic EQ</TabsTrigger>
            <TabsTrigger value="video">Video</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Server Admin</TabsTrigger>}
            <div className="my-1 border-t" />
            <TabsTrigger value="logout" className="text-destructive data-[state=active]:text-destructive">
              Log Out
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-[360px] max-h-[70vh] overflow-y-auto overflow-x-hidden px-3">
            <TabsContent value="account">
              <AccountTab
                serverIP={serverIP}
                accessToken={accessToken}
                username={username}
                profilePhoto={profilePhoto}
                onProfilePhotoChange={onProfilePhotoChange}
                nameColor={nameColor}
                onNameColorChange={onNameColorChange}
                settings={settings}
                updateSettings={updateSettings}
              />
            </TabsContent>
            <TabsContent value="voice">
              <VoiceTab voiceRef={voiceRef} settings={settings} updateSettings={updateSettings} />
            </TabsContent>
            <TabsContent value="eq">
              <EqTab voiceRef={voiceRef} settings={settings} updateSettings={updateSettings} />
            </TabsContent>
            <TabsContent value="video">
              <VideoTab voiceRef={voiceRef} />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="admin">
                <AdminTab
                  serverIP={serverIP}
                  totalUsers={totalUsers}
                  onlineCount={onlineCount}
                  textChannelCount={textChannelCount}
                  voiceChannelCount={voiceChannelCount}
                />
              </TabsContent>
            )}
            <TabsContent value="logout">
              <LogoutTab onLogout={onLogout} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
