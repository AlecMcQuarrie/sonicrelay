import { useEffect, useRef, useState } from "react";
import ChannelSidebar from "~/components/channel-sidebar/ChannelSidebar";
import TextChannel from "~/components/text-channel/TextChannel";

type Channel = {
  name: string;
  $id: string;
};

interface ServerProps {
  serverIP: string;
  accessToken: string;
  username: string;
}

export default function Server({ serverIP, accessToken, username }: ServerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch channels and connect to websocket
  useEffect(() => {
    fetch(`http://${serverIP}/channels`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setChannels(data.channels);
        if (data.channels.length > 0) {
          setSelectedChannelId(data.channels[0].$id);
        }
      });

    const ws = new WebSocket(`ws://${serverIP}?token=${accessToken}`);
    wsRef.current = ws;

    return () => ws.close();
  }, [accessToken]);

  const selectedChannel = channels.find((c) => c.$id === selectedChannelId);

  return (
    <div className="flex h-screen">
      <ChannelSidebar
        channels={channels}
        selectedChannelId={selectedChannelId}
        onSelectChannel={setSelectedChannelId}
      />
      {selectedChannel ? (
        <TextChannel
          serverIP={serverIP}
          channelId={selectedChannel.$id}
          channelName={selectedChannel.name}
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
