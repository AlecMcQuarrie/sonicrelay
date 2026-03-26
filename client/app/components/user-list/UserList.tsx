import { Users } from "lucide-react";

interface UserListProps {
  users: string[];
  onlineUsers: Set<string>;
}

export default function UserList({ users, onlineUsers }: UserListProps) {
  const sorted = [...users].sort((a, b) => {
    const aOnline = onlineUsers.has(a);
    const bOnline = onlineUsers.has(b);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.localeCompare(b);
  });

  const onlineCount = sorted.filter((u) => onlineUsers.has(u)).length;

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
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${online ? "text-foreground" : "text-muted-foreground/50"
                }`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${online ? "bg-green-500" : "bg-muted-foreground/30"
                  }`}
              />
              {user}
            </div>
          );
        })}
      </div>
    </div>
  );
}
