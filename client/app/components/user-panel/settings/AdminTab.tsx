interface AdminTabProps {
  serverIP: string;
  totalUsers: number;
  onlineCount: number;
  channelCount: number;
}

export default function AdminTab({ serverIP, totalUsers, onlineCount, channelCount }: AdminTabProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Server Admin</h3>
      <Row label="Server" value={serverIP} />
      <Row label="Total users" value={String(totalUsers)} />
      <Row label="Online now" value={String(onlineCount)} />
      <Row label="Channels" value={String(channelCount)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
