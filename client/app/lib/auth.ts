import {
  generateKeyPair,
  exportPublicKey,
  generateSalt,
  deriveWrappingKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  savePrivateKeyToSession,
} from "./crypto";
import { getProtocol } from "./protocol";

export type StoredConnection = {
  serverId: string;
  serverName: string;
  serverIP: string;
  username: string;
  accessToken: string;
  encryptedPrivateKey: string;
  pbkdfSalt: string;
};

export type JoinServerArgs = {
  serverIP: string;
  username: string;
  password: string;
  isRegistration: boolean;
};

export type JoinServerResult = {
  connection: StoredConnection;
  privateKey: CryptoKey;
};

async function fetchServerInfo(serverIP: string): Promise<{ serverId: string; serverName: string }> {
  const protocol = getProtocol(serverIP);
  const res = await fetch(`${protocol}://${serverIP}/server-info`);
  if (!res.ok) {
    throw new Error(`Could not reach server at ${serverIP}`);
  }
  return res.json();
}

export async function joinServer({
  serverIP,
  username,
  password,
  isRegistration,
}: JoinServerArgs): Promise<JoinServerResult> {
  const protocol = getProtocol(serverIP);

  // Identify the server first — we key all stored state by its stable serverId.
  const { serverId, serverName } = await fetchServerInfo(serverIP);

  const body: Record<string, string> = { username, password };

  // On signup, generate an E2E keypair and wrap the private key with the password.
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

  const endpoint = isRegistration ? "signup" : "login";
  const response = await fetch(`${protocol}://${serverIP}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();

  let unlockedPrivateKey: CryptoKey | null = generatedPrivateKey;
  let finalEncryptedPrivateKey: string = isRegistration ? body.encryptedPrivateKey : data.encryptedPrivateKey;
  let finalPbkdfSalt: string = isRegistration ? body.pbkdfSalt : data.pbkdfSalt;

  if (!isRegistration) {
    const hasValidKeys =
      data.encryptedPrivateKey && data.pbkdfSalt && data.encryptedPrivateKey.startsWith("{");
    if (hasValidKeys) {
      const salt = new Uint8Array(base64ToArrayBuffer(data.pbkdfSalt));
      const wrappingKey = await deriveWrappingKey(password, salt);
      unlockedPrivateKey = await unwrapPrivateKey(data.encryptedPrivateKey, wrappingKey);
    } else {
      // Legacy account without encryption keys — generate them now and upload.
      const keyPair = await generateKeyPair();
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
      const salt = generateSalt();
      const wrappingKey = await deriveWrappingKey(password, salt);
      const wrappedPrivateKey = await wrapPrivateKey(keyPair.privateKey, wrappingKey);
      finalEncryptedPrivateKey = wrappedPrivateKey;
      finalPbkdfSalt = arrayBufferToBase64(salt.buffer as ArrayBuffer);
      unlockedPrivateKey = keyPair.privateKey;

      await fetch(`${protocol}://${serverIP}/me/encryption-keys`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "access-token": data.accessToken },
        body: JSON.stringify({
          publicKey: publicKeyBase64,
          encryptedPrivateKey: finalEncryptedPrivateKey,
          pbkdfSalt: finalPbkdfSalt,
        }),
      });
    }
  }

  if (!unlockedPrivateKey) {
    throw new Error("Failed to unlock private key");
  }

  await savePrivateKeyToSession(serverId, unlockedPrivateKey);

  const connection: StoredConnection = {
    serverId,
    serverName,
    serverIP,
    username,
    accessToken: data.accessToken,
    encryptedPrivateKey: finalEncryptedPrivateKey,
    pbkdfSalt: finalPbkdfSalt,
  };

  return { connection, privateKey: unlockedPrivateKey };
}
