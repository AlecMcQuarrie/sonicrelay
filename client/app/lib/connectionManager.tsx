import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StoredConnection } from "./auth";
import { clearPrivateKeyFromSession } from "./crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type VoiceStatus = {
  channelId: string;
  channelName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
};

export type VoiceActions = {
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  leave: () => void;
};

type ConnectionManagerContextValue = {
  connections: StoredConnection[];
  activeServerId: string | null;
  privateKeys: Record<string, CryptoKey>;
  unreadByServer: Record<string, number>;
  activeVoiceServerId: string | null;
  voiceStatusByServer: Record<string, VoiceStatus | null>;

  setActive: (serverId: string) => void;
  addConnection: (connection: StoredConnection, privateKey: CryptoKey) => void;
  removeConnection: (serverId: string) => void;
  setPrivateKey: (serverId: string, key: CryptoKey) => void;

  setUnreadCount: (serverId: string, count: number) => void;
  setVoiceStatus: (serverId: string, status: VoiceStatus | null) => void;

  claimVoice: (serverId: string) => Promise<void>;
  releaseVoice: (serverId: string) => void;
  registerVoiceLeaveHandler: (serverId: string, handler: () => Promise<void> | void) => void;
  unregisterVoiceLeaveHandler: (serverId: string) => void;

  registerVoiceActions: (serverId: string, actions: VoiceActions) => void;
  unregisterVoiceActions: (serverId: string) => void;
  getVoiceActions: (serverId: string) => VoiceActions | undefined;
};

const ConnectionManagerContext = createContext<ConnectionManagerContextValue | null>(null);

// ─── localStorage persistence ────────────────────────────────────────────────

const CONNECTIONS_KEY = "servers";
const ACTIVE_KEY = "activeServerId";

function loadConnectionsFromStorage(): StoredConnection[] {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    return Object.values(parsed) as StoredConnection[];
  } catch {
    return [];
  }
}

function loadActiveFromStorage(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function persistConnections(connections: StoredConnection[]) {
  const map: Record<string, StoredConnection> = {};
  for (const c of connections) map[c.serverId] = c;
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(map));
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ConnectionManagerProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<StoredConnection[]>(() => loadConnectionsFromStorage());
  const [activeServerId, setActiveServerId] = useState<string | null>(() => loadActiveFromStorage());
  const [privateKeys, setPrivateKeys] = useState<Record<string, CryptoKey>>({});
  const [unreadByServer, setUnreadByServer] = useState<Record<string, number>>({});
  const [activeVoiceServerId, setActiveVoiceServerId] = useState<string | null>(null);
  const [voiceStatusByServer, setVoiceStatusByServer] = useState<Record<string, VoiceStatus | null>>({});

  // Callback registries live in refs — they should not trigger re-renders.
  const voiceLeaveHandlersRef = useRef<Record<string, () => Promise<void> | void>>({});
  const voiceActionsRef = useRef<Record<string, VoiceActions>>({});

  // Persist connections + active server on change.
  useEffect(() => {
    persistConnections(connections);
  }, [connections]);

  useEffect(() => {
    if (activeServerId) localStorage.setItem(ACTIVE_KEY, activeServerId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeServerId]);

  // Auto-select the first connection if the active one goes away (or was never set).
  useEffect(() => {
    if (connections.length === 0) {
      if (activeServerId !== null) setActiveServerId(null);
      return;
    }
    const stillExists = connections.some((c) => c.serverId === activeServerId);
    if (!stillExists) setActiveServerId(connections[0].serverId);
  }, [connections, activeServerId]);

  const setActive = useCallback((serverId: string) => {
    setActiveServerId(serverId);
  }, []);

  const addConnection = useCallback((connection: StoredConnection, privateKey: CryptoKey) => {
    setConnections((prev) => {
      const filtered = prev.filter((c) => c.serverId !== connection.serverId);
      return [...filtered, connection];
    });
    setPrivateKeys((prev) => ({ ...prev, [connection.serverId]: privateKey }));
    setActiveServerId(connection.serverId);
  }, []);

  const removeConnection = useCallback((serverId: string) => {
    setConnections((prev) => prev.filter((c) => c.serverId !== serverId));
    setPrivateKeys((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    setUnreadByServer((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    setVoiceStatusByServer((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    delete voiceLeaveHandlersRef.current[serverId];
    delete voiceActionsRef.current[serverId];
    setActiveVoiceServerId((prev) => (prev === serverId ? null : prev));
    clearPrivateKeyFromSession(serverId);
  }, []);

  const setPrivateKey = useCallback((serverId: string, key: CryptoKey) => {
    setPrivateKeys((prev) => ({ ...prev, [serverId]: key }));
  }, []);

  const setUnreadCount = useCallback((serverId: string, count: number) => {
    setUnreadByServer((prev) => {
      if (prev[serverId] === count) return prev;
      return { ...prev, [serverId]: count };
    });
  }, []);

  const setVoiceStatus = useCallback((serverId: string, status: VoiceStatus | null) => {
    setVoiceStatusByServer((prev) => ({ ...prev, [serverId]: status }));
  }, []);

  // Global voice lock — only one server can hold an active voice session.
  const claimVoice = useCallback(async (serverId: string) => {
    const previous = activeVoiceServerIdRef.current;
    if (previous && previous !== serverId) {
      const leave = voiceLeaveHandlersRef.current[previous];
      if (leave) {
        try {
          await leave();
        } catch (err) {
          console.warn("claimVoice: previous server leave failed", err);
        }
      }
    }
    activeVoiceServerIdRef.current = serverId;
    setActiveVoiceServerId(serverId);
  }, []);

  const releaseVoice = useCallback((serverId: string) => {
    if (activeVoiceServerIdRef.current === serverId) {
      activeVoiceServerIdRef.current = null;
      setActiveVoiceServerId(null);
    }
  }, []);

  // Shadow ref so claimVoice can read the current value without stale closures.
  const activeVoiceServerIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeVoiceServerIdRef.current = activeVoiceServerId;
  }, [activeVoiceServerId]);

  const registerVoiceLeaveHandler = useCallback((serverId: string, handler: () => Promise<void> | void) => {
    voiceLeaveHandlersRef.current[serverId] = handler;
  }, []);

  const unregisterVoiceLeaveHandler = useCallback((serverId: string) => {
    delete voiceLeaveHandlersRef.current[serverId];
  }, []);

  const registerVoiceActions = useCallback((serverId: string, actions: VoiceActions) => {
    voiceActionsRef.current[serverId] = actions;
  }, []);

  const unregisterVoiceActions = useCallback((serverId: string) => {
    delete voiceActionsRef.current[serverId];
  }, []);

  const getVoiceActions = useCallback((serverId: string) => {
    return voiceActionsRef.current[serverId];
  }, []);

  const value = useMemo<ConnectionManagerContextValue>(
    () => ({
      connections,
      activeServerId,
      privateKeys,
      unreadByServer,
      activeVoiceServerId,
      voiceStatusByServer,
      setActive,
      addConnection,
      removeConnection,
      setPrivateKey,
      setUnreadCount,
      setVoiceStatus,
      claimVoice,
      releaseVoice,
      registerVoiceLeaveHandler,
      unregisterVoiceLeaveHandler,
      registerVoiceActions,
      unregisterVoiceActions,
      getVoiceActions,
    }),
    [
      connections,
      activeServerId,
      privateKeys,
      unreadByServer,
      activeVoiceServerId,
      voiceStatusByServer,
      setActive,
      addConnection,
      removeConnection,
      setPrivateKey,
      setUnreadCount,
      setVoiceStatus,
      claimVoice,
      releaseVoice,
      registerVoiceLeaveHandler,
      unregisterVoiceLeaveHandler,
      registerVoiceActions,
      unregisterVoiceActions,
      getVoiceActions,
    ],
  );

  return (
    <ConnectionManagerContext.Provider value={value}>{children}</ConnectionManagerContext.Provider>
  );
}

export function useConnectionManager(): ConnectionManagerContextValue {
  const ctx = useContext(ConnectionManagerContext);
  if (!ctx) throw new Error("useConnectionManager must be used within ConnectionManagerProvider");
  return ctx;
}
