import { Users } from "lucide-react";
import Avatar from "~/components/ui/avatar";

interface UserListProps {
  users: string[];
  onlineUsers: Set<string>;
  profilePhotos: Record<string, string | null>;
  serverIP: string;
}

export default function UserList({ users, onlineUsers, profilePhotos, serverIP }: UserListProps) {
  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
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
          return (
            <div
              key={user}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${
                online ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              <Avatar username={user} profilePhoto={photoUrl(user)} size="sm" />
              {user}
            </div>
          );
        })}
      </div>
    </div>
  );
}
