import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Hash, Volume2, VolumeX, Mic, MicOff, HeadphoneOff } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";

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
  speakingUsers: Set<string>;
  peerPings: Record<string, number>;
  videoTracks: Map<string, MediaStreamTrack>;
  screenTracks: Map<string, MediaStreamTrack>;
  screenAudioUsers: Set<string>;
  focusedFeeds: Set<string>;
  localUsername: string;
  selfMutedUsers: Set<string>;
  deafenedUsers: Set<string>;
  voicePeerSettings: Record<string, VoicePeerSetting>;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
  onFocusVideo: (key: string) => void;
  onScreenAudioVolume: (username: string, volume: number) => void;
  onScreenAudioMute: (username: string, muted: boolean) => void;
  onUserVolume: (username: string, volume: number) => void;
  onUserMute: (username: string, muted: boolean) => void;
}

function pingColor(ms: number): string {
  if (ms < 80) return "text-green-500";
  if (ms < 150) return "text-yellow-500";
  return "text-red-500";
}

function ScreenAudioControls({ username, onVolume, onMute }: {
  username: string;
  onVolume: (username: string, volume: number) => void;
  onMute: (username: string, muted: boolean) => void;
}) {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  return (
    <div className="p-2 space-y-2 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-medium">Screen Audio</div>
      <div className="flex items-center gap-2">
        <button
          className="shrink-0 p-0.5 rounded hover:bg-muted"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onMute(username, next);
          }}
        >
          {muted
            ? <VolumeX className="w-3.5 h-3.5 text-red-500" />
            : <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          className="w-full h-1 accent-foreground"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            onVolume(username, v);
          }}
        />
      </div>
    </div>
  );
}

function PeerVolumeMenu({ username, setting, onVolume, onMute }: {
  username: string;
  setting: VoicePeerSetting;
  onVolume: (username: string, volume: number) => void;
  onMute: (username: string, muted: boolean) => void;
}) {
  const [volume, setVolume] = useState(setting.volume);
  const [muted, setMuted] = useState(setting.muted);

  return (
    <div className="p-2 space-y-2 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-medium truncate">{username}</div>
      <div className="flex items-center gap-2">
        <button
          className="shrink-0 p-0.5 rounded hover:bg-muted"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            onMute(username, next);
          }}
        >
          {muted
            ? <MicOff className="w-3.5 h-3.5 text-red-500" />
            : <Mic className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          className="w-full h-1 accent-foreground"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            onVolume(username, v);
          }}
        />
      </div>
    </div>
  );
}

function PeerVideo({ track, onClick }: { track: MediaStreamTrack; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);

  return (
    <div className="aspect-video bg-black rounded overflow-hidden cursor-pointer" onClick={onClick}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export default function ChannelSidebar({
  channels,
  selectedTextChannelId,
  voiceChannelId,
  voicePeers,
  speakingUsers,
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
  onUserVolume,
  onUserMute,
}: ChannelSidebarProps) {
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground">
        Text Channels
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
          </Button>
        ))}
      </div>

      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground">
        Voice Channels
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
                {user !== localUsername ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div className="py-1 text-sm text-muted-foreground flex items-center gap-2 cursor-default">
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 transition-colors ${speakingUsers.has(user) ? "bg-green-500" : "bg-muted-foreground/40"}`}
                        />
                        <span className="flex-1 truncate">{user}</span>
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
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <PeerVolumeMenu
                        username={user}
                        setting={voicePeerSettings[user] || { volume: 1, muted: false }}
                        onVolume={onUserVolume}
                        onMute={onUserMute}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                ) : (
                  <div className="py-1 text-sm text-muted-foreground flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 transition-colors ${speakingUsers.has(user) ? "bg-green-500" : "bg-muted-foreground/40"}`}
                    />
                    <span className="flex-1 truncate">{user}</span>
                    {selfMutedUsers.has(user) && (
                      <MicOff className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                    {deafenedUsers.has(user) && (
                      <HeadphoneOff className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                    {peerPings[user] !== undefined && (
                      <span className={`text-[10px] font-mono ${pingColor(peerPings[user])}`}>
                        {peerPings[user]}ms
                      </span>
                    )}
                  </div>
                )}
                {videoTracks.has(user) && !focusedFeeds.has(`camera:${user}`) && (
                  <PeerVideo track={videoTracks.get(user)!} onClick={() => onFocusVideo(`camera:${user}`)} />
                )}
                {screenTracks.has(user) && !focusedFeeds.has(`screen:${user}`) && (
                  screenAudioUsers.has(user) ? (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div>
                          <PeerVideo track={screenTracks.get(user)!} onClick={() => onFocusVideo(`screen:${user}`)} />
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ScreenAudioControls username={user} onVolume={onScreenAudioVolume} onMute={onScreenAudioMute} />
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    <PeerVideo track={screenTracks.get(user)!} onClick={() => onFocusVideo(`screen:${user}`)} />
                  )
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
