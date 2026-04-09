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
      const parsedData = JSON.parse(data);
      // Force re-login if account is missing encryption keys or has old format
      const epk = parsedData.encryptedPrivateKey;
      if (!epk || !parsedData.pbkdfSalt || !epk.startsWith('{')) {
        localStorage.removeItem("connectionData");
        setIsNewSession(true);
        return;
      }
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
    // If the account has no encryption keys (created before E2E), generate and upload them
    let unlockedPrivateKey: CryptoKey | null = generatedPrivateKey;
    let finalEncryptedPrivateKey = isRegistration ? body.encryptedPrivateKey : data.encryptedPrivateKey;
    let finalPbkdfSalt = isRegistration ? body.pbkdfSalt : data.pbkdfSalt;

    if (!isRegistration) {
      const hasValidKeys = data.encryptedPrivateKey && data.pbkdfSalt && data.encryptedPrivateKey.startsWith('{');
      if (hasValidKeys) {
        const salt = new Uint8Array(base64ToArrayBuffer(data.pbkdfSalt));
        const wrappingKey = await deriveWrappingKey(password, salt);
        unlockedPrivateKey = await unwrapPrivateKey(data.encryptedPrivateKey, wrappingKey);
      } else {
        // Existing account without keys — generate and upload
        const keyPair = await generateKeyPair();
        const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
        const salt = generateSalt();
        const wrappingKey = await deriveWrappingKey(password, salt);
        const wrappedPrivateKey = await wrapPrivateKey(keyPair.privateKey, wrappingKey);
        finalEncryptedPrivateKey = wrappedPrivateKey;
        finalPbkdfSalt = arrayBufferToBase64(salt.buffer as ArrayBuffer);
        unlockedPrivateKey = keyPair.privateKey;

        // Upload keys to server
        await fetch(`${protocol}://${serverIP}/me/encryption-keys`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'access-token': data.accessToken },
          body: JSON.stringify({
            publicKey: publicKeyBase64,
            encryptedPrivateKey: finalEncryptedPrivateKey,
            pbkdfSalt: finalPbkdfSalt,
          }),
        });
      }
    }
    setPrivateKey(unlockedPrivateKey);

    const formattedConnectionData = {
      serverIP,
      username,
      accessToken: data.accessToken,
      encryptedPrivateKey: finalEncryptedPrivateKey,
      pbkdfSalt: finalPbkdfSalt,
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
