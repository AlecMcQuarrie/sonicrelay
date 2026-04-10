import { useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/home";
import ServerJoin from "~/components/server-join/ServerJoin";
import Server from "~/components/server/Server";
import ServerRail from "~/components/server-rail/ServerRail";
import CrossServerVoiceBar from "~/components/voice-controls/CrossServerVoiceBar";
import UpdateBanner from "~/components/update-banner/UpdateBanner";
import {
  ConnectionManagerProvider,
  useConnectionManager,
} from "~/lib/connectionManager";
import { joinServer, type StoredConnection } from "~/lib/auth";
import {
  base64ToArrayBuffer,
  loadPrivateKeyFromSession,
  savePrivateKeyToSession,
} from "~/lib/crypto";
import { getProtocol } from "~/lib/protocol";

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
  return (
    <ConnectionManagerProvider>
      <HomeShell />
    </ConnectionManagerProvider>
  );
}

// ─── Legacy single-server migration ────────────────────────────────────────
// Older clients stored a single connection under `connectionData` and a
// single private key under `dm_private_key`. Convert that into the new
// `servers` map on first load, then delete the legacy keys.
async function migrateLegacyConnection(): Promise<
  { connection: StoredConnection; privateKey: CryptoKey } | null
> {
  const raw = localStorage.getItem("connectionData");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.serverIP || !parsed.accessToken || !parsed.username) {
      localStorage.removeItem("connectionData");
      return null;
    }

    // Fetch the server's stable identity.
    const protocol = getProtocol(parsed.serverIP);
    const info = await fetch(`${protocol}://${parsed.serverIP}/server-info`).then((r) => r.json());

    // Pull the legacy private key from its old localStorage slot.
    const legacyPkcs8 = localStorage.getItem("dm_private_key");
    if (!legacyPkcs8) {
      localStorage.removeItem("connectionData");
      return null;
    }
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      base64ToArrayBuffer(legacyPkcs8),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"],
    );

    const connection: StoredConnection = {
      serverId: info.serverId,
      serverName: info.serverName,
      serverIP: parsed.serverIP,
      username: parsed.username,
      accessToken: parsed.accessToken,
      encryptedPrivateKey: parsed.encryptedPrivateKey,
      pbkdfSalt: parsed.pbkdfSalt,
    };

    // Save under the new per-server key, then delete the legacy blobs.
    await savePrivateKeyToSession(info.serverId, privateKey);
    localStorage.removeItem("connectionData");
    localStorage.removeItem("dm_private_key");

    return { connection, privateKey };
  } catch (err) {
    console.warn("Legacy connection migration failed:", err);
    return null;
  }
}

function HomeShell() {
  const {
    connections,
    activeServerId,
    privateKeys,
    addConnection,
    setPrivateKey,
  } = useConnectionManager();
  const [bootstrapped, setBootstrapped] = useState(false);

  // On initial load: migrate legacy storage, then restore private keys for all
  // persisted connections from their per-server localStorage slots.
  useEffect(() => {
    (async () => {
      const migrated = await migrateLegacyConnection();
      if (migrated) {
        addConnection(migrated.connection, migrated.privateKey);
      }

      // Restore private keys for any persisted connections we haven't unlocked yet.
      for (const connection of connections) {
        if (privateKeys[connection.serverId]) continue;
        const key = await loadPrivateKeyFromSession(connection.serverId);
        if (key) setPrivateKey(connection.serverId, key);
      }

      setBootstrapped(true);
    })();
    // Intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFirstJoin = useCallback(
    async (args: {
      serverIP: string;
      username: string;
      password: string;
      isRegistration: boolean;
    }) => {
      const { connection, privateKey } = await joinServer(args);
      addConnection(connection, privateKey);
    },
    [addConnection],
  );

  if (!bootstrapped) return null;

  // First-run experience: no servers yet → full-page join form.
  if (connections.length === 0) {
    return <ServerJoin submitForm={handleFirstJoin} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <ServerRail />
        <div className="flex-1 flex flex-col min-w-0">
          <CrossServerVoiceBar />
          <div className="flex-1 flex min-h-0 relative">
            {connections.map((connection) => (
              <Server
                key={connection.serverId}
                connection={connection}
                privateKey={privateKeys[connection.serverId] ?? null}
                isActive={connection.serverId === activeServerId}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
