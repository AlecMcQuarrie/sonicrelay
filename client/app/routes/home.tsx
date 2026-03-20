import { useEffect, useState } from "react";
import type { Route } from "./+types/home";
import ServerJoin from "~/server-join/ServerJoin";

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
  const [connectionData, setConnectionData] = useState(null);
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

  if (isNewSession) {
    return <ServerJoin></ServerJoin>;
  }
  return (
    <>
      <h1>hi</h1>
    </>
  );
}
