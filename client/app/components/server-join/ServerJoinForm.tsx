import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
} from "~/components/ui/field";

export type ServerJoinSubmit = (args: {
  serverIP: string;
  username: string;
  password: string;
  isRegistration: boolean;
}) => Promise<void>;

interface ServerJoinFormProps {
  submitForm: ServerJoinSubmit;
  defaultServerIP?: string;
}

export default function ServerJoinForm({ submitForm, defaultServerIP = "" }: ServerJoinFormProps) {
  const [serverIP, setServerIP] = useState<string>(defaultServerIP);
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [signupMode, setSignupMode] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitForm({ serverIP, username, password, isRegistration: signupMode });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setBusy(false);
    }
  };

  const canSubmit = !busy && serverIP && username && password;

  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ textAlign: "center", marginTop: "5px", marginBottom: "0px", fontSize: "20px" }}>
          Login to The Server
        </CardTitle>
        <CardDescription style={{ textAlign: "center", marginBottom: "20px" }}>
          Enter Server Details to Login
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form>
          <FieldGroup>
            <Field>
              <h3 style={{ textAlign: "left" }}>
                {">>"}
                <span style={{ marginLeft: "12px" }}>SERVER IP</span>
              </h3>
              <Input
                placeholder="Enter Server IP"
                className="placeholder:italic"
                value={serverIP}
                onChange={(e) => setServerIP(e.target.value)}
                required
              />
            </Field>
            <Field>
              <h3 style={{ textAlign: "left" }}>
                {">>"}
                <span style={{ marginLeft: "12px" }}>USERNAME</span>
              </h3>
              <Input
                placeholder="Enter Username"
                className="placeholder:italic"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field>
              <h3 style={{ textAlign: "left" }}>
                {">>"}
                <span style={{ marginLeft: "12px" }}>PASSWORD</span>
              </h3>
              <Input
                type="password"
                placeholder="Enter Password"
                className="placeholder:italic"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <Field>
              <Button disabled={!canSubmit} onClick={handleSubmit}>
                {busy ? "Connecting..." : signupMode ? "Sign Up" : "Login"}
              </Button>
              <FieldDescription className="text-center">
                {signupMode ? (
                  <>
                    Already have an account?{" "}
                    <a onClick={() => setSignupMode(false)}>Login</a>
                  </>
                ) : (
                  <>
                    Don&apos;t have an account?{" "}
                    <a onClick={() => setSignupMode(true)}>Sign up</a>
                  </>
                )}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
