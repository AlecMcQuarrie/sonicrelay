import { cn } from "~/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import type { StoredConnection } from "~/lib/auth";

interface ServerRailItemProps {
  connection: StoredConnection;
  isActive: boolean;
  unreadCount: number;
  hasActiveVoice: boolean;
  onSelect: () => void;
  onDisconnect: () => void;
}

export default function ServerRailItem({
  connection,
  isActive,
  unreadCount,
  hasActiveVoice,
  onSelect,
  onDisconnect,
}: ServerRailItemProps) {
  const initial = connection.serverName.charAt(0).toUpperCase();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          title={connection.serverName}
          className={cn(
            "relative w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-all",
            "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            "hover:rounded-xl",
            isActive && "bg-accent text-accent-foreground rounded-xl",
          )}
        >
          {/* Active indicator bar on the left edge */}
          <span
            className={cn(
              "absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-foreground rounded-r-full transition-all",
              isActive ? "h-8" : unreadCount > 0 ? "h-2" : "h-0",
            )}
          />
          {initial}
          {unreadCount > 0 && !isActive && (
            <span className="absolute -bottom-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 border-2 border-background">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          {hasActiveVoice && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-background" />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onDisconnect} className="text-red-500">
          Disconnect
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
