import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface ServerJoinProps {
  submitForm: (serverIP: string, username: string, password: string) => void;
}

export default function ServerJoin({ submitForm }: ServerJoinProps) {
  const [serverIP, setServerIP] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  return (
    <div className="max-w-sm m-auto flex flex-col h-screen justify-center">
      <h1>Server info</h1>
      <Input
        placeholder="Server IP"
        value={serverIP}
        onChange={(e) => setServerIP(e.target.value)}
      />
      <Input
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Input
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button
        disabled={!serverIP || !username || !password}
        onClick={() => submitForm(serverIP, username, password)}
      >
        Login
      </Button>
    </div>
  );
}
