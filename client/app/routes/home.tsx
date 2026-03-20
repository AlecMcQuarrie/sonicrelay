import { useEffect, useState } from "react";
import type { Route } from "./+types/home";
import ServerJoin from "~/components/server-join/ServerJoin";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "RipV2" },
    {
      name: "description",
      content: "Highly secure, robust, discord alternative.",
    },
  ];
}

export default function Home() {
  // Variables
  const [connectionData, setConnectionData] = useState<any>(null); // Temporary "any" type, do not use any
  const [isNewSession, setIsNewSession] = useState(true);

  // Initial load, only runs once
  // Checks for previous connection data in the browser's local storage
  useEffect(() => {
    const data = localStorage.getItem("connectionData");

    if (data) {
      // If there is connection data, set the data to an existing session
      const parsedData = JSON.parse(data);
      setConnectionData(parsedData);
      setIsNewSession(false);
    }
  }, []);

  const joinServer = (serverIP: string, username: string, password: string) => {
    const data = {
      serverIP,
      username,
      password, // THIS IS TEMPORARY! DO NOT STORE PASSWORDS IN PLAIN TEXT LOL
    };
    localStorage.setItem("connectionData", JSON.stringify(data));
    setConnectionData(data);
  };

  if (isNewSession) {
    return <ServerJoin submitForm={joinServer}></ServerJoin>;
  } else {
    return (
      <>
        <h1>hi</h1>
      </>
    );
  }
}
