import { useState } from "react";
import { Plus } from "lucide-react";
import { useConnectionManager } from "~/lib/connectionManager";
import ServerRailItem from "./ServerRailItem";
import AddServerDialog from "./AddServerDialog";

export default function ServerRail() {
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
      <div className="w-[72px] h-full bg-background/60 border-r flex flex-col items-center gap-2 py-3 shrink-0">
        {connections.map((connection) => (
          <ServerRailItem
            key={connection.serverId}
            connection={connection}
            isActive={connection.serverId === activeServerId}
            unreadCount={unreadByServer[connection.serverId] ?? 0}
            hasActiveVoice={connection.serverId === activeVoiceServerId}
            onSelect={() => setActive(connection.serverId)}
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
      </div>
      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
