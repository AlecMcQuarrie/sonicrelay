import { useState } from "react";
import { Plus } from "lucide-react";
import { useConnectionManager } from "~/lib/connectionManager";
import ServerRailItem from "./ServerRailItem";
import AddServerDialog from "./AddServerDialog";

interface ServerRailContentProps {
  onAfterSelect?: () => void;
}

export function ServerRailContent({ onAfterSelect }: ServerRailContentProps) {
  const {
    connections,
    activeServerId,
    unreadByServer,
    activeVoiceServerId,
    setActive,
    removeConnection,
  } = useConnectionManager();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      {connections.map((connection) => (
        <ServerRailItem
          key={connection.serverId}
          connection={connection}
          isActive={connection.serverId === activeServerId}
          unreadCount={unreadByServer[connection.serverId] ?? 0}
          hasActiveVoice={connection.serverId === activeVoiceServerId}
          onSelect={() => {
            setActive(connection.serverId);
            onAfterSelect?.();
          }}
          onDisconnect={() => removeConnection(connection.serverId)}
        />
      ))}
      <button
        onClick={() => setAddOpen(true)}
        title="Add server"
        className="w-12 h-12 rounded-full flex items-center justify-center bg-muted text-green-500 hover:rounded-xl hover:bg-green-500 hover:text-white transition-all"
      >
        <Plus className="w-5 h-5" />
      </button>
      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

export default function ServerRail() {
  return (
    <div className="hidden md:flex w-[72px] h-full bg-background/60 border-r flex-col items-center gap-2 py-3 shrink-0">
      <ServerRailContent />
    </div>
  );
}
