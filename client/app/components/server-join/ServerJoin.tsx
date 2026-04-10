import ServerJoinForm, { type ServerJoinSubmit } from "./ServerJoinForm";

interface ServerJoinProps {
  submitForm: ServerJoinSubmit;
}

export default function ServerJoin({ submitForm }: ServerJoinProps) {
  return (
    <div className="max-w-sm m-auto flex flex-col h-screen justify-center">
      <h1
        style={{
          textAlign: "center",
          marginBottom: "0px",
          fontSize: "24px",
        }}
      >
        <strong>
          <span>
            <span style={{ fontSize: "32px" }}>[</span>
            <span style={{ padding: "0 4px", position: "relative", top: "-2px" }}>SONICRELAY</span>
            <span style={{ fontSize: "32px" }}>]</span>
          </span>
        </strong>
      </h1>
      <h6 style={{ textAlign: "center", marginBottom: "30px" }}> // secure channel established</h6>
      <ServerJoinForm submitForm={submitForm} />
    </div>
  );
}
