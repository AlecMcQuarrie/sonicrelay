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
  const wsRef = useRef<WebSocket | null>(null);
  const voiceRef = useRef<VoiceClient | null>(null);

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
        data.users.forEach((u: { username: string; profilePhoto: string | null }) => {
          photos[u.username] = u.profilePhoto;
        });
        setProfilePhotos(photos);
      });

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
      }
      if (msg.type === 'presence') {
        setOnlineUsers(new Set(msg.onlineUsers));
      }
      if (msg.type === 'voice-pings') {
        setPeerPings(msg.pings);
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
  }, [voiceChannelId, username]);

  const leaveVoiceChannel = useCallback(async () => {
    await voiceRef.current?.leave();
    setVoiceChannelId(null);
    setIsMuted(false);
    setIsCameraOn(false);
    setIsScreenSharing(false);
  }, []);

  const toggleMute = useCallback(() => {
    const muted = voiceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
  }, []);

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

  const selectedTextChannel = channels.find((c) => c.__id === selectedTextChannelId);
  const currentVoiceChannel = channels.find((c) => c.__id === voiceChannelId);

  return (
    <div className="flex h-screen">
      <div className="w-60 border-r flex flex-col h-screen">
        <div className="p-4 border-b font-bold">
          ripv2
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
            isCameraOn={isCameraOn}
            isScreenSharing={isScreenSharing}
            onToggleMute={toggleMute}
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
        <UserList users={allUsers} onlineUsers={onlineUsers} profilePhotos={profilePhotos} serverIP={serverIP} />
      </div>
    </div>
  );
}
