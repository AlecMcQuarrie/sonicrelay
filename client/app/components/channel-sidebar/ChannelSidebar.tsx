import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Hash, Volume2, MicOff, HeadphoneOff, Plus } from "lucide-react";
import PeerVolumeMenu from "./PeerVolumeMenu";
import ScreenAudioControls from "./ScreenAudioControls";
import CreateChannelDialog from "./CreateChannelDialog";
import DmConversationList from "~/components/dm/DmConversationList";
import UnreadBadge from "~/components/ui/unread-badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "~/components/ui/dropdown-menu";

type Channel = {
  name: string;
  type: "text" | "voice";
  __id: string;
};

type VoicePeerSetting = {
  volume: number;
  muted: boolean;
};

interface ChannelSidebarProps {
  channels: Channel[];
  selectedTextChannelId: string | null;
  voiceChannelId: string | null;
  voicePeers: Record<string, string[]>;
  speakingLevels: Map<string, number>;
  peerPings: Record<string, number>;
  videoTracks: Map<string, MediaStreamTrack>;
  screenTracks: Map<string, MediaStreamTrack>;
  screenAudioUsers: Set<string>;
  focusedFeeds: Set<string>;
  localUsername: string;
  selfMutedUsers: Set<string>;
  deafenedUsers: Set<string>;
  voicePeerSettings: Record<string, VoicePeerSetting>;
  screenAudioPeerSettings: Record<string, VoicePeerSetting>;
  unreadCounts: Record<string, number>;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
  onFocusVideo: (key: string) => void;
  onScreenAudioVolume: (username: string, volume: number) => void;
  onScreenAudioMute: (username: string, muted: boolean) => void;
  onUserVolume: (username: string, volume: number) => void;
  onUserMute: (username: string, muted: boolean) => void;
  canCreateChannel: boolean;
  onCreateChannel: (name: string, type: "text" | "voice") => void;
  dmConversations: { partner: string; lastTimestamp: string }[];
  selectedDmPartner: string | null;
  onSelectDm: (partner: string) => void;
  profilePhotos: Record<string, string | null>;
  serverIP: string;
  uploadToken: string | null;
}

function pingColor(ms: number): string {
  if (ms < 80) return "text-green-500";
  if (ms < 150) return "text-yellow-500";
  return "text-red-500";
}


function PeerRow({ user, isSelf, speakingLevels, selfMutedUsers, deafenedUsers, voicePeerSettings, screenAudioPeerSettings, peerPings, hasScreenAudio, isScreenSharing, onUserVolume, onUserMute, onScreenAudioVolume, onScreenAudioMute }: {
  user: string;
  isSelf?: boolean;
  speakingLevels: Map<string, number>;
  selfMutedUsers: Set<string>;
  deafenedUsers: Set<string>;
  voicePeerSettings: Record<string, VoicePeerSetting>;
  screenAudioPeerSettings: Record<string, VoicePeerSetting>;
  peerPings: Record<string, number>;
  hasScreenAudio: boolean;
  isScreenSharing: boolean;
  onUserVolume: (username: string, volume: number) => void;
  onUserMute: (username: string, muted: boolean) => void;
  onScreenAudioVolume: (username: string, volume: number) => void;
  onScreenAudioMute: (username: string, muted: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className="py-1 text-sm text-muted-foreground flex items-center gap-2 cursor-pointer select-none hover:bg-accent rounded-md px-1"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${(speakingLevels.get(user) ?? 0) > 0.05 ? "bg-green-500" : "bg-muted-foreground/40"}`}
            style={{
              opacity: 0.4 + 0.6 * (speakingLevels.get(user) ?? 0),
              transform: `scale(${0.85 + 0.3 * (speakingLevels.get(user) ?? 0)})`,
            }}
          />
          <span className={`flex-1 truncate ${isScreenSharing ? "text-red-500" : ""}`}>{user}</span>
          {selfMutedUsers.has(user) && (
            <MicOff className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          {deafenedUsers.has(user) && (
            <HeadphoneOff className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          {voicePeerSettings[user]?.muted && (
            <MicOff className="w-3 h-3 text-red-500 shrink-0" />
          )}
          {peerPings[user] !== undefined && (
            <span className={`text-[10px] font-mono ${pingColor(peerPings[user])}`}>
              {peerPings[user]}ms
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <PeerVolumeMenu
          username={user}
          setting={voicePeerSettings[user] || { volume: 1, muted: false }}
          disabled={isSelf}
          onVolume={onUserVolume}
          onMute={onUserMute}
        />
        {hasScreenAudio && (
          <>
            <div className="mx-2 my-1 border-t" />
            <ScreenAudioControls
              username={user}
              setting={screenAudioPeerSettings[user] || { volume: 1, muted: false }}
              disabled={isSelf}
              onVolume={onScreenAudioVolume}
              onMute={onScreenAudioMute}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PeerVideo({ track, label, onClick }: { track: MediaStreamTrack; label: string; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  return (
    <button
      type="button"
      aria-label={label}
      className="aspect-video bg-black rounded overflow-hidden cursor-pointer w-full p-0 border-0"
      onClick={onClick}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
    </button>
  );
}

export default function ChannelSidebar({
  channels,
  selectedTextChannelId,
  unreadCounts,
  voiceChannelId,
  voicePeers,
  speakingLevels,
  peerPings,
  videoTracks,
  screenTracks,
  screenAudioUsers,
  focusedFeeds,
  onSelectTextChannel,
  onJoinVoiceChannel,
  onFocusVideo,
  onScreenAudioVolume,
  onScreenAudioMute,
  localUsername,
  selfMutedUsers,
  deafenedUsers,
  voicePeerSettings,
  screenAudioPeerSettings,
  onUserVolume,
  onUserMute,
  canCreateChannel,
  onCreateChannel,
  dmConversations,
  selectedDmPartner,
  onSelectDm,
  profilePhotos,
  serverIP,
  uploadToken,
}: ChannelSidebarProps) {
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogType, setCreateDialogType] = useState<"text" | "voice">("text");

  const openCreateDialog = (type: "text" | "voice") => {
    setCreateDialogType(type);
    setCreateDialogOpen(true);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground flex items-center justify-between">
        Text Channels
        {canCreateChannel && (
          <button onClick={() => openCreateDialog("text")} className="hover:text-foreground transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="px-2 pb-1 space-y-1">
        {textChannels.map((channel) => (
          <Button
            key={channel.__id}
            variant={channel.__id === selectedTextChannelId ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => onSelectTextChannel(channel.__id)}
          >
            <Hash className="w-4 h-4 mr-1" />
            {channel.name}
            <UnreadBadge count={unreadCounts[channel.__id] || 0} />
          </Button>
        ))}
      </div>

      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground flex items-center justify-between">
        Voice Channels
        {canCreateChannel && (
          <button onClick={() => openCreateDialog("voice")} className="hover:text-foreground transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="px-2 space-y-1">
        {voiceChannels.map((channel) => (
          <div key={channel.__id}>
            <Button
              variant={channel.__id === voiceChannelId ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => onJoinVoiceChannel(channel.__id)}
            >
              <Volume2 className="w-4 h-4 mr-1" />
              {channel.name}
            </Button>
            {voicePeers[channel.__id]?.sort().map((user) => (
              <div key={user}>
                <PeerRow
                  user={user}
                  isSelf={user === localUsername}
                  speakingLevels={speakingLevels}
                  selfMutedUsers={selfMutedUsers}
                  deafenedUsers={deafenedUsers}
                  voicePeerSettings={voicePeerSettings}
                  screenAudioPeerSettings={screenAudioPeerSettings}
                  peerPings={peerPings}
                  hasScreenAudio={screenAudioUsers.has(user)}
                  isScreenSharing={screenTracks.has(user)}
                  onUserVolume={onUserVolume}
                  onUserMute={onUserMute}
                  onScreenAudioVolume={onScreenAudioVolume}
                  onScreenAudioMute={onScreenAudioMute}
                />
                {videoTracks.has(user) && !focusedFeeds.has(`camera:${user}`) && (
                  <PeerVideo
                    track={videoTracks.get(user)!}
                    label={`Focus ${user}'s camera`}
                    onClick={() => onFocusVideo(`camera:${user}`)}
                  />
                )}
                {screenTracks.has(user) && !focusedFeeds.has(`screen:${user}`) && (
                  <PeerVideo
                    track={screenTracks.get(user)!}
                    label={`Focus ${user}'s screen share`}
                    onClick={() => onFocusVideo(`screen:${user}`)}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <DmConversationList
        conversations={dmConversations}
        selectedPartner={selectedDmPartner}
        onSelectDm={onSelectDm}
        profilePhotos={profilePhotos}
        serverIP={serverIP}
        uploadToken={uploadToken}
        unreadCounts={unreadCounts}
      />

      <CreateChannelDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultType={createDialogType}
        onCreateChannel={onCreateChannel}
      />
    </div>
  );
}
