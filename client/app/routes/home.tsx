import { useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/home";
import ServerJoin from "~/components/server-join/ServerJoin";
import Server from "~/components/server/Server";

export function meta({ }: Route.MetaArgs) {
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
  const [isNewSession, setIsNewSession] = useState<boolean | null>(null);

  // Initial load, only runs once
  // Checks for previous connection data in the browser's local storage
  useEffect(() => {
    const data = localStorage.getItem("connectionData");

    if (data) {
      // If there is connection data, set the data to an existing session
      const parsedData = JSON.parse(data);
      setConnectionData(parsedData);
      setIsNewSession(false);
    } else {
      setIsNewSession(true);
    }
  }, []);

  const joinServer = useCallback(async (serverIP: string, username: string, password: string, isRegistration: boolean) => {
    const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
    const response = await fetch(`${protocol}://${serverIP}/${isRegistration ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const formattedConnectionData = {
      serverIP,
      username,
      accessToken: data.accessToken
    };
    localStorage.setItem("connectionData", JSON.stringify(formattedConnectionData));
    setConnectionData(formattedConnectionData);
    setIsNewSession(false);
  }, [setConnectionData, connectionData]);

  if (isNewSession === null) {
    return null;
  } else if (isNewSession) {
    return <ServerJoin submitForm={joinServer}></ServerJoin>;
  } else {
    return (
      <Server
        serverIP={connectionData.serverIP}
        accessToken={connectionData.accessToken}
        username={connectionData.username}
      />
    );
  }
}
