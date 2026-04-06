import { useState } from "react";
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
  isSelf: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onBanClick: () => void;
}

export default function UserRow({ user, online, photoUrl, targetRole, myRole, isSelf, onPromote, onDemote, onBanClick }: UserRowProps) {
  const [open, setOpen] = useState(false);

  const canPromote = !isSelf
    && myRole !== 'member'
    && targetRole === 'member';

  const canDemote = !isSelf
    && targetRole === 'admin'
    && myRole === 'superadmin';

  const canBan = !isSelf
    && myRole !== 'member'
    && targetRole !== 'superadmin'
    && (myRole === 'superadmin' || targetRole === 'member');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer select-none hover:bg-accent ${
            online ? "text-foreground" : "text-muted-foreground/50"
          }`}
        >
          <Avatar username={user} profilePhoto={photoUrl} size="sm" />
          <span className="flex-1 truncate">{user}</span>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {targetRole !== 'member' && <RoleBadge role={targetRole} />}
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                online ? "bg-green-500" : "bg-muted-foreground/30"
              }`}
            />
          </div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targetRole === 'admin' ? (
          <DropdownMenuItem disabled={!canDemote} onSelect={onDemote}>Remove admin</DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={!canPromote} onSelect={onPromote}>Make admin</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!canBan}
          onSelect={onBanClick}
        >
          Ban user
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
