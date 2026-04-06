import { MoreVertical } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import RoleBadge from "~/components/ui/role-badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";

type Role = 'superadmin' | 'admin' | 'member';

interface UserRowProps {
  user: string;
  online: boolean;
  photoUrl: string | null;
  targetRole: Role;
  myRole: Role;
  canAct: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onBanClick: () => void;
}

export default function UserRow({ user, online, photoUrl, targetRole, myRole, canAct, onPromote, onDemote, onBanClick }: UserRowProps) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${
        online ? "text-foreground" : "text-muted-foreground/50"
      }`}
    >
      <Avatar username={user} profilePhoto={photoUrl} size="sm" />
      <span className="flex-1 truncate">{user}</span>
      {targetRole !== 'member' && <RoleBadge role={targetRole} />}
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
          online ? "bg-green-500" : "bg-muted-foreground/30"
        }`}
      />
      {canAct && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
              aria-label={`Actions for ${user}`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {targetRole === 'admin' ? (
              <DropdownMenuItem onSelect={onDemote}>Remove admin</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onPromote}>Make admin</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={targetRole === 'admin' && myRole !== 'superadmin'}
              onSelect={onBanClick}
            >
              Ban user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
