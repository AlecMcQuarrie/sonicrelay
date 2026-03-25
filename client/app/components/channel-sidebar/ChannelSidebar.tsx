import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

type Channel = {
  name: string;
  $id: string;
};

interface ChannelSidebarProps {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
}

export default function ChannelSidebar({ channels, selectedChannelId, onSelectChannel }: ChannelSidebarProps) {
  return (
    <div className="w-60 border-r flex flex-col h-screen">
      <div className="p-4 font-bold text-sm uppercase tracking-wide text-muted-foreground">
        Text Channels
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {channels.map((channel) => (
          <Button
            key={channel.$id}
            variant={channel.$id === selectedChannelId ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => onSelectChannel(channel.$id)}
          >
            # {channel.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
