import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Hash, Volume2 } from "lucide-react";

type Channel = {
  name: string;
  type: "text" | "voice";
  __id: string;
};

interface ChannelSidebarProps {
  channels: Channel[];
  selectedTextChannelId: string | null;
  voiceChannelId: string | null;
  voicePeers: Record<string, string[]>;
  speakingUsers: Set<string>;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
}

export default function ChannelSidebar({
  channels,
  selectedTextChannelId,
  voiceChannelId,
  voicePeers,
  speakingUsers,
  onSelectTextChannel,
  onJoinVoiceChannel,
}: ChannelSidebarProps) {
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground">
        Text Channels
      </div>
      <div className="px-2 space-y-1">
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

      <Separator className="my-2" />

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
            {voicePeers[channel.__id]?.map((user) => (
              <div
                key={user}
                className={`pl-8 py-1 text-sm flex items-center gap-2 ${
                  speakingUsers.has(user) ? "text-green-400" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    speakingUsers.has(user) ? "bg-green-400" : "bg-muted-foreground/40"
                  }`}
                />
                {user}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
