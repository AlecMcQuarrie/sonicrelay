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
} from "~/components/ui/field";

interface ServerJoinProps {
  submitForm: (serverIP: string, username: string, password: string, isRegistration: boolean) => void;
}

export default function ServerJoin({ submitForm }: ServerJoinProps) {
  const [serverIP, setServerIP] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [signupMode, setSignupMode] = useState<boolean>(false);

  return (
    <div className="max-w-sm m-auto flex flex-col h-screen justify-center">
      <h1
        style={{
          textAlign: "center",
          marginBottom: "0px",
          fontSize: "24px"
        }}
      >
        <strong>
          <span>
            <span style={{ fontSize: "32px" }}>[</span>
            <span style={{ padding: "0 4px", position: "relative", top: "-2px" }}>RIPCORD V2</span>
            <span style={{ fontSize: "32px" }}>]</span>
          </span>
        </strong>
      </h1>
      <h6 style={{ textAlign: "center", marginBottom: "30px" }}> // secure channel established</h6>
      <Card>
        <CardHeader>
          <CardTitle style={{ textAlign: "center", marginTop: "5px", marginBottom: "0px", fontSize: "20px" }}>Login to The Server</CardTitle>
          <CardDescription style={{ textAlign: "center", marginBottom: "20px" }}>Enter Server Details to Login</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <FieldGroup>
              <Field>
                <h3>
                  <h3 style={{ textAlign: "left" }}>
                    {">>"}
                    <span style={{ marginLeft: "12px" }}>SERVER IP</span>
                  </h3>
                </h3>
                <Input
                  placeholder="Enter Server IP"
                  className="placeholder:italic"
                  onChange={(e) => setServerIP(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <h3>
                  <h3 style={{ textAlign: "left" }}>
                    {">>"}
                    <span style={{ marginLeft: "12px" }}>USERNAME</span>
                  </h3>
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
                <h3>
                  <h3 style={{ textAlign: "left" }}>
                    {">>"}
                    <span style={{ marginLeft: "12px" }}>PASSWORD</span>
                  </h3>
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
              {signupMode ? (
                <Field>
                  <Button disabled={!serverIP || !username || !password} onClick={(e) => {
                    e.preventDefault();
                    submitForm(serverIP, username, password, signupMode)
                  }}>Sign Up</Button>
                  <FieldDescription className="text-center">
                    Already have an account?{" "}
                    <a onClick={() => setSignupMode(false)}>Login</a>
                  </FieldDescription>
                </Field>
              ) : (
                <Field>
                  <Button disabled={!serverIP || !username || !password} onClick={(e) => {
                    e.preventDefault();
                    submitForm(serverIP, username, password, signupMode)
                  }}>Login</Button>
                  <FieldDescription className="text-center">
                    Don&apos;t have an account?{" "}
                    <a onClick={() => setSignupMode(true)}>Sign up</a>
                  </FieldDescription>
                </Field>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}