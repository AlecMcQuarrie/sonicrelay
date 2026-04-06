import { useCallback, useEffect, useRef, useState } from "react";
import ChannelSidebar from "~/components/channel-sidebar/ChannelSidebar";
import FocusedVideo from "~/components/focused-video/FocusedVideo";
import TextChannel from "~/components/text-channel/TextChannel";
import UserList from "~/components/user-list/UserList";
import UserPanel from "~/components/user-panel/UserPanel";
import VoiceControls from "~/components/voice-controls/VoiceControls";
import { VoiceClient } from "~/lib/voice";

type Channel = {
  name: string;
  type: "text" | "voice";
  __id: string; // simpl.db serializes $id as __id in JSON
};

type Role = 'superadmin' | 'admin' | 'member';

interface ServerProps {
  serverIP: string;
  accessToken: string;
  username: string;
}

export default function Server({ serverIP, accessToken, username }: ServerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedTextChannelId, setSelectedTextChannelId] = useState<string | null>(null);
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voicePeers, setVoicePeers] = useState<Record<string, string[]>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const [peerPings, setPeerPings] = useState<Record<string, number>>({});
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [videoTracks, setVideoTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [screenTracks, setScreenTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [screenAudioUsers, setScreenAudioUsers] = useState<Set<string>>(new Set());
  const [focusedVideoUsers, setFocusedVideoUsers] = useState<Set<string>>(new Set());
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string | null>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [selfMutedUsers, setSelfMutedUsers] = useState<Set<string>>(new Set());
  const [deafenedUsers, setDeafenedUsers] = useState<Set<string>>(new Set());
  const [isDeafened, setIsDeafened] = useState(false);
  const [voicePeerSettings, setVoicePeerSettings] = useState<Record<string, { volume: number; muted: boolean }>>({});
  const [myRole, setMyRole] = useState<Role>('member');
  const [userRoles, setUserRoles] = useState<Record<string, Role>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const voiceRef = useRef<VoiceClient | null>(null);
  const voicePeerSettingsRef = useRef(voicePeerSettings);
  voicePeerSettingsRef.current = voicePeerSettings;

  // Fetch channels and set up WebSocket
  useEffect(() => {
    const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';

    fetch(`${protocol}://${serverIP}/channels`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setChannels(data.channels);
        const firstText = data.channels.find((c: Channel) => c.type === "text");
        if (firstText) setSelectedTextChannelId(firstText.__id);
      });

    fetch(`${protocol}://${serverIP}/users`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setAllUsers(data.users.map((u: { username: string }) => u.username));
        const photos: Record<string, string | null> = {};
        const roles: Record<string, Role> = {};
        data.users.forEach((u: { username: string; profilePhoto: string | null; role: Role }) => {
          photos[u.username] = u.profilePhoto;
          roles[u.username] = u.role || 'member';
        });
        setProfilePhotos(photos);
        setUserRoles(roles);
      });

    fetch(`${protocol}://${serverIP}/me`, {
      method: 'POST',
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setMyRole((data.role as Role) || 'member'));

    fetch(`${protocol}://${serverIP}/me/voice-peer-settings`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setVoicePeerSettings(data.voicePeerSettings || {}));

    const ws = new WebSocket(`${wsProtocol}://${serverIP}?token=${accessToken}`);
    wsRef.current = ws;

    // Initialize voice client
    voiceRef.current = new VoiceClient(ws, {
      onPeerJoined: (channelId, user) => {
        setVoicePeers((prev) => {
          const current = prev[channelId] || [];
          if (current.includes(user)) return prev;
          return { ...prev, [channelId]: [...current, user] };
        });
        // Apply saved volume/mute settings once audio element is ready
        setTimeout(() => {
          const s = voicePeerSettingsRef.current[user];
          if (s) {
            voiceRef.current?.setUserVolume(user, s.volume);
            voiceRef.current?.setUserMuted(user, s.muted);
          }
        }, 500);
      },
      onPeerLeft: (channelId, user) => {
        setVoicePeers((prev) => ({
          ...prev,
          [channelId]: (prev[channelId] || []).filter((u) => u !== user),
        }));
      },
      onSpeakingChange: (user, isSpeaking) => {
        setSpeakingUsers((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(user);
          else next.delete(user);
          return next;
        });
      },
      onVideoTrack: (user, track) => {
        setVideoTracks((prev) => {
          const next = new Map(prev);
          if (track) next.set(user, track);
          else {
            next.delete(user);
            setFocusedVideoUsers((prev) => {
              const key = `camera:${user}`;
              if (!prev.has(key)) return prev;
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }
          return next;
        });
      },
      onScreenTrack: (user, track) => {
        setScreenTracks((prev) => {
          const next = new Map(prev);
          if (track) next.set(user, track);
          else {
            next.delete(user);
            setFocusedVideoUsers((prev) => {
              const key = `screen:${user}`;
              if (!prev.has(key)) return prev;
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }
          return next;
        });
        // Sync isScreenSharing for local user
        if (user === username) setIsScreenSharing(!!track);
      },
      onScreenAudioChange: (user, available) => {
        setScreenAudioUsers((prev) => {
          const next = new Set(prev);
          if (available) next.add(user);
          else next.delete(user);
          return next;
        });
      },
    });

    // Handle server pushes for voice state and presence
    const handleServerMessages = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'voice-state') {
        setVoicePeers(msg.voicePeers);
        if (msg.mutedUsers) setSelfMutedUsers(new Set(msg.mutedUsers));
        if (msg.deafenedUsers) setDeafenedUsers(new Set(msg.deafenedUsers));
      }
      if (msg.type === 'mute-state') {
        setSelfMutedUsers((prev) => {
          const next = new Set(prev);
          if (msg.muted) next.add(msg.username);
          else next.delete(msg.username);
          return next;
        });
      }
      if (msg.type === 'deafen-state') {
        setDeafenedUsers((prev) => {
          const next = new Set(prev);
          if (msg.deafened) next.add(msg.username);
          else next.delete(msg.username);
          return next;
        });
      }
      if (msg.type === 'presence') {
        setOnlineUsers(new Set(msg.onlineUsers));
        // If there are online users we haven't seen, re-fetch the full user list
        setAllUsers((prev) => {
          const known = new Set(prev);
          const hasNew = msg.onlineUsers.some((u: string) => !known.has(u));
          if (hasNew) {
            fetch(`${protocol}://${serverIP}/users`, {
              headers: { 'access-token': accessToken },
            })
              .then((res) => res.json())
              .then((data) => {
                setAllUsers(data.users.map((u: { username: string }) => u.username));
                const photos: Record<string, string | null> = {};
                data.users.forEach((u: { username: string; profilePhoto: string | null }) => {
                  photos[u.username] = u.profilePhoto;
                });
                setProfilePhotos(photos);
              });
          }
          return prev;
        });
      }
      if (msg.type === 'voice-pings') {
        setPeerPings(msg.pings);
      }
      if (msg.type === 'role-changed') {
        setUserRoles((prev) => ({ ...prev, [msg.username]: msg.role }));
        if (msg.username === username) setMyRole(msg.role);
      }
      if (msg.type === 'user-banned') {
        setAllUsers((prev) => prev.filter((u) => u !== msg.username));
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(msg.username);
          return next;
        });
        setUserRoles((prev) => {
          const next = { ...prev };
          delete next[msg.username];
          return next;
        });
      }
    };
    ws.addEventListener('message', handleServerMessages);

    return () => {
      voiceRef.current?.leave();
      voiceRef.current?.destroy();
      ws.close();
    };
  }, [serverIP, accessToken]);

  const joinVoiceChannel = useCallback(async (channelId: string) => {
    if (voiceChannelId === channelId) return;
    if (voiceChannelId) await voiceRef.current?.leave();
    await voiceRef.current?.join(channelId, username);
    setVoiceChannelId(channelId);
    setIsMuted(false);
    setIsCameraOn(false);
    setIsScreenSharing(false);
    setIsDeafened(false);
    // Apply saved volume/mute settings for existing peers
    setTimeout(() => {
      for (const [user, s] of Object.entries(voicePeerSettingsRef.current)) {
        voiceRef.current?.setUserVolume(user, s.volume);
        voiceRef.current?.setUserMuted(user, s.muted);
      }
    }, 500);
  }, [voiceChannelId, username]);

  const leaveVoiceChannel = useCallback(async () => {
    await voiceRef.current?.leave();
    setVoiceChannelId(null);
    setIsMuted(false);
    setIsCameraOn(false);
    setIsScreenSharing(false);
    setIsDeafened(false);
  }, []);

  const toggleMute = useCallback(() => {
    const muted = voiceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
    wsRef.current?.send(JSON.stringify({ type: 'mute-state', muted }));
  }, []);

  const toggleDeafen = useCallback(() => {
    const next = !isDeafened;
    setIsDeafened(next);
    voiceRef.current?.setDeafened(next);
    wsRef.current?.send(JSON.stringify({ type: 'deafen-state', deafened: next }));
    // Deafening also mutes you (like Discord)
    if (next && !isMuted) {
      const muted = voiceRef.current?.toggleMute() ?? false;
      setIsMuted(muted);
      wsRef.current?.send(JSON.stringify({ type: 'mute-state', muted: true }));
    }
    // Undeafening does NOT auto-unmute — user must unmute manually
  }, [isDeafened, isMuted]);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      await voiceRef.current?.stopVideo();
    } else {
      await voiceRef.current?.startVideo();
    }
    setIsCameraOn(!isCameraOn);
  }, [isCameraOn]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await voiceRef.current?.stopScreenShare();
    } else {
      await voiceRef.current?.startScreenShare();
    }
  }, [isScreenSharing]);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  const saveVoicePeerSetting = useCallback((peerUsername: string, volume: number, muted: boolean) => {
    fetch(`${protocol}://${serverIP}/me/voice-peer-settings`, {
      method: 'PUT',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ peerUsername, volume, muted }),
    });
  }, [serverIP, accessToken, protocol]);

  const handleUserVolume = useCallback((user: string, volume: number) => {
    voiceRef.current?.setUserVolume(user, volume);
    setVoicePeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, volume };
      saveVoicePeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveVoicePeerSetting]);

  const handleUserMute = useCallback((user: string, muted: boolean) => {
    voiceRef.current?.setUserMuted(user, muted);
    setVoicePeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, muted };
      saveVoicePeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveVoicePeerSetting]);

  const banUser = useCallback((target: string) => {
    fetch(`${protocol}://${serverIP}/users/${target}/ban`, {
      method: 'POST',
      headers: { "access-token": accessToken },
    });
  }, [protocol, serverIP, accessToken]);

  const setUserRole = useCallback((target: string, role: Role) => {
    fetch(`${protocol}://${serverIP}/users/${target}/role`, {
      method: 'PUT',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }, [protocol, serverIP, accessToken]);

  const selectedTextChannel = channels.find((c) => c.__id === selectedTextChannelId);
  const currentVoiceChannel = channels.find((c) => c.__id === voiceChannelId);

  return (
    <div className="flex h-screen">
      <div className="w-60 border-r flex flex-col h-screen">
        <div className="px-4 py-1 border-b font-bold text-center">
          <span className="text-[32px]">[</span>
          <span className="relative -top-[2px] px-1 text-2xl">SONICRELAY</span>
          <span className="text-[32px]">]</span>
        </div>
        <ChannelSidebar
          channels={channels}
          selectedTextChannelId={selectedTextChannelId}
          voiceChannelId={voiceChannelId}
          voicePeers={voicePeers}
          speakingUsers={speakingUsers}
          peerPings={peerPings}
          videoTracks={videoTracks}
          screenTracks={screenTracks}
          screenAudioUsers={screenAudioUsers}
          focusedFeeds={focusedVideoUsers}
          onSelectTextChannel={setSelectedTextChannelId}
          onScreenAudioVolume={(user, vol) => voiceRef.current?.setScreenAudioVolume(user, vol)}
          onScreenAudioMute={(user, muted) => voiceRef.current?.setScreenAudioMuted(user, muted)}
          localUsername={username}
          selfMutedUsers={selfMutedUsers}
          deafenedUsers={deafenedUsers}
          voicePeerSettings={voicePeerSettings}
          onUserVolume={handleUserVolume}
          onUserMute={handleUserMute}
          onJoinVoiceChannel={joinVoiceChannel}
          onFocusVideo={(user) => {
            setFocusedVideoUsers((prev) => {
              const next = new Set(prev);
              if (next.has(user)) next.delete(user);
              else next.add(user);
              return next;
            });
          }}
        />
        {currentVoiceChannel && (
          <VoiceControls
            channelName={currentVoiceChannel.name}
            isMuted={isMuted}
            isDeafened={isDeafened}
            isCameraOn={isCameraOn}
            isScreenSharing={isScreenSharing}
            onToggleMute={toggleMute}
            onToggleDeafen={toggleDeafen}
            onToggleCamera={toggleCamera}
            onToggleScreenShare={toggleScreenShare}
            onDisconnect={leaveVoiceChannel}
          />
        )}
        <UserPanel
          username={username}
          serverIP={serverIP}
          profilePhoto={profilePhotos[username]}
          accessToken={accessToken}
          onProfilePhotoChange={(url) => setProfilePhotos((prev) => ({ ...prev, [username]: url }))}
        />
      </div>
      <div className="flex-1 relative overflow-hidden">
        {selectedTextChannel ? (
          <TextChannel
            serverIP={serverIP}
            channelId={selectedTextChannel.__id}
            channelName={selectedTextChannel.name}
            accessToken={accessToken}
            username={username}
            wsRef={wsRef}
            profilePhotos={profilePhotos}
            myRole={myRole}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select a channel
          </div>
        )}
        {focusedVideoUsers.size > 0 && (() => {
          const focusedTracks = new Map<string, MediaStreamTrack>();
          for (const key of focusedVideoUsers) {
            const [source, user] = key.split(':');
            const trackMap = source === 'screen' ? screenTracks : videoTracks;
            const track = trackMap.get(user);
            if (track) focusedTracks.set(key, track);
          }
          if (focusedTracks.size === 0) return null;
          return (
            <FocusedVideo
              videoTracks={focusedTracks}
              onRemove={(user) => {
                setFocusedVideoUsers((prev) => {
                  const next = new Set(prev);
                  next.delete(user);
                  return next;
                });
              }}
              onCloseAll={() => setFocusedVideoUsers(new Set())}
            />
          );
        })()}
      </div>
      <div className="w-52 border-l h-screen">
        <UserList
          users={allUsers}
          onlineUsers={onlineUsers}
          profilePhotos={profilePhotos}
          serverIP={serverIP}
          myUsername={username}
          myRole={myRole}
          userRoles={userRoles}
          onBan={banUser}
          onSetRole={setUserRole}
        />
      </div>
    </div>
  );
}
