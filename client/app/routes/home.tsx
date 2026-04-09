import { useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/home";
import ServerJoin from "~/components/server-join/ServerJoin";
import Server from "~/components/server/Server";
import {
  generateKeyPair,
  exportPublicKey,
  generateSalt,
  deriveWrappingKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "~/lib/crypto";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "SonicRelay.io" },
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
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);

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

    let body: Record<string, string> = { username, password };

    // On signup, generate E2E encryption keypair and wrap the private key
    let generatedPrivateKey: CryptoKey | null = null;
    if (isRegistration) {
      const keyPair = await generateKeyPair();
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
      const salt = generateSalt();
      const wrappingKey = await deriveWrappingKey(password, salt);
      const wrappedPrivateKey = await wrapPrivateKey(keyPair.privateKey, wrappingKey);
      body.publicKey = publicKeyBase64;
      body.encryptedPrivateKey = wrappedPrivateKey;
      body.pbkdfSalt = arrayBufferToBase64(salt.buffer as ArrayBuffer);
      generatedPrivateKey = keyPair.privateKey;
    }

    const response = await fetch(`${protocol}://${serverIP}/${isRegistration ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    // On login, unwrap the private key from the server response
    let unlockedPrivateKey: CryptoKey | null = generatedPrivateKey;
    if (!isRegistration && data.encryptedPrivateKey && data.pbkdfSalt) {
      const salt = new Uint8Array(base64ToArrayBuffer(data.pbkdfSalt));
      const wrappingKey = await deriveWrappingKey(password, salt);
      unlockedPrivateKey = await unwrapPrivateKey(data.encryptedPrivateKey, wrappingKey);
    }
    setPrivateKey(unlockedPrivateKey);

    const formattedConnectionData = {
      serverIP,
      username,
      accessToken: data.accessToken,
      encryptedPrivateKey: isRegistration ? body.encryptedPrivateKey : data.encryptedPrivateKey,
      pbkdfSalt: isRegistration ? body.pbkdfSalt : data.pbkdfSalt,
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
        privateKey={privateKey}
        encryptedPrivateKey={connectionData.encryptedPrivateKey || null}
        pbkdfSalt={connectionData.pbkdfSalt || null}
        onPrivateKeyUnlocked={setPrivateKey}
      />
    );
  }
}
