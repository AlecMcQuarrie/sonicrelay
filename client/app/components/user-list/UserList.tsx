import { useState } from "react";
import { Users } from "lucide-react";
import UserRow from "./UserRow";
import BanDialog from "./BanDialog";
import { getProtocol } from "~/lib/protocol";

type Role = 'superadmin' | 'admin' | 'member';

interface UserListProps {
  users: string[];
  onlineUsers: Set<string>;
  profilePhotos: Record<string, string | null>;
  serverIP: string;
  myUsername: string;
  myRole: Role;
  userRoles: Record<string, Role>;
  onBan: (username: string) => void;
  onSetRole: (username: string, role: Role) => void;
  onStartDm: (username: string) => void;
}

export default function UserList({
  users, onlineUsers, profilePhotos, serverIP,
  myUsername, myRole, userRoles, onBan, onSetRole, onStartDm,
}: UserListProps) {
  const protocol = getProtocol(serverIP);
  const [banTarget, setBanTarget] = useState<string | null>(null);

  const sorted = [...users].sort((a, b) => {
    const aOnline = onlineUsers.has(a);
    const bOnline = onlineUsers.has(b);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.localeCompare(b);
  });

  const onlineCount = sorted.filter((u) => onlineUsers.has(u)).length;

  const photoUrl = (username: string) => {
    const photo = profilePhotos[username];
    return photo ? `${protocol}://${serverIP}${photo}` : null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b font-bold flex items-center gap-2">
        <Users className="w-4 h-4" />
        {onlineCount}/{sorted.length}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {sorted.map((user) => {
          const online = onlineUsers.has(user);
          const targetRole = userRoles[user] || 'member';
          return (
            <UserRow
              key={user}
              user={user}
              online={online}
              photoUrl={photoUrl(user)}
              targetRole={targetRole}
              myRole={myRole}
              isSelf={user === myUsername}
              onPromote={() => onSetRole(user, 'admin')}
              onDemote={() => onSetRole(user, 'member')}
              onBanClick={() => setBanTarget(user)}
              onMessage={() => onStartDm(user)}
            />
          );
        })}
      </div>

      <BanDialog
        username={banTarget}
        onClose={() => setBanTarget(null)}
        onConfirm={onBan}
      />
    </div>
  );
}
