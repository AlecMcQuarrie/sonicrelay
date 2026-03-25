import { useCallback, useEffect, useRef, useState } from "react";
import ChannelSidebar from "~/components/channel-sidebar/ChannelSidebar";
import TextChannel from "~/components/text-channel/TextChannel";
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
    });

    // Handle initial voice state from server
    const handleVoiceState = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'voice-state') {
        setVoicePeers(msg.voicePeers);
      }
    };
    ws.addEventListener('message', handleVoiceState);

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
  }, [voiceChannelId, username]);

  const leaveVoiceChannel = useCallback(async () => {
    await voiceRef.current?.leave();
    setVoiceChannelId(null);
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const muted = voiceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
  }, []);

  const selectedTextChannel = channels.find((c) => c.__id === selectedTextChannelId);
  const currentVoiceChannel = channels.find((c) => c.__id === voiceChannelId);

  return (
    <div className="flex h-screen">
      <div className="w-60 border-r flex flex-col h-screen">
        <ChannelSidebar
          channels={channels}
          selectedTextChannelId={selectedTextChannelId}
          voiceChannelId={voiceChannelId}
          voicePeers={voicePeers}
          speakingUsers={speakingUsers}
          onSelectTextChannel={setSelectedTextChannelId}
          onJoinVoiceChannel={joinVoiceChannel}
        />
        {currentVoiceChannel && (
          <VoiceControls
            channelName={currentVoiceChannel.name}
            isMuted={isMuted}
            isSpeaking={speakingUsers.has(username)}
            onToggleMute={toggleMute}
            onDisconnect={leaveVoiceChannel}
          />
        )}
      </div>
      {selectedTextChannel ? (
        <TextChannel
          serverIP={serverIP}
          channelId={selectedTextChannel.__id}
          channelName={selectedTextChannel.name}
          accessToken={accessToken}
          username={username}
          wsRef={wsRef}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Select a channel
        </div>
      )}
    </div>
  );
}
