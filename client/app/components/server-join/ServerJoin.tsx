import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field"


interface ServerJoinProps {
  submitForm: (serverIP: string, username: string, password: string) => void;
}

export default function ServerJoin({ submitForm }: ServerJoinProps) {
  const [serverIP, setServerIP] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  return (
    <div className="max-w-sm m-auto flex flex-col h-screen justify-center">
      <Card>
        <CardHeader>
          <CardTitle>Login to The Server</CardTitle>
          <CardDescription>Enter Server Details to Login</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <FieldGroup>
              <Field>
                <Input
                  placeholder="Server IP"
                  value={serverIP}
                  onChange={(e) => setServerIP(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <Input
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <Input
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <Button type="submit">Login</Button>
                <FieldDescription className="text-center">
                  Don&apos;t have an account? <a href="#">Sign up</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}