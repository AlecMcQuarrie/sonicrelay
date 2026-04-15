import { Button } from "~/components/ui/button";

interface LogoutTabProps {
  onLogout: () => void;
}

export default function LogoutTab({ onLogout }: LogoutTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Log Out</h3>
      <p className="text-sm text-muted-foreground">
        Disconnect from this server and remove it from your connections.
      </p>
      <Button variant="destructive" onClick={onLogout}>Log Out</Button>
    </div>
  );
}
