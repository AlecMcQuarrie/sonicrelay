import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChannelSidebar from "~/components/channel-sidebar/ChannelSidebar";
import DirectMessage from "~/components/dm/DirectMessage";
import FocusedVideo from "~/components/focused-video/FocusedVideo";
import TextChannel from "~/components/text-channel/TextChannel";
import UserList from "~/components/user-list/UserList";
import UserPanel from "~/components/user-panel/UserPanel";
import VoiceControls from "~/components/voice-controls/VoiceControls";
import { ShieldAlert, Menu, Users } from "lucide-react";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { ServerRailContent } from "~/components/server-rail/ServerRail";
import { VoiceClient } from "~/lib/voice";
import type { ScreenShareSettings } from "~/lib/voice";
import { RemoteControlClient, type RemoteControlSession, type RemoteControlInputEvent } from "~/lib/remoteControl";
import GrantRequestDialog from "~/components/remote-control/GrantRequestDialog";
import ActiveSessionBanner from "~/components/remote-control/ActiveSessionBanner";
import { getProtocol, getWsProtocol } from "~/lib/protocol";
import { useTheme } from "next-themes";
import {
  DEFAULT_SETTINGS,
  loadCachedSettings,
  cacheSettings,
  applyVoiceSettings,
  type UserSettings,
} from "~/lib/settings";
import { useCustomThemeVars, CUSTOM_THEME_ID } from "~/lib/themes";
import useDmState from "~/hooks/useDmState";
import useNotifications from "~/hooks/useNotifications";
import type { StoredConnection } from "~/lib/auth";
import { useConnectionManager } from "~/lib/connectionManager";
import { MessageCacheStore, channelKey, dmKey, type ChannelCacheEntry } from "~/lib/messageCache";
import { decrypt } from "~/lib/crypto";

type Channel = {
  name: string;
  type: "text" | "voice";
  __id: string; // simpl.db serializes $id as __id in JSON
};

type Role = 'superadmin' | 'admin' | 'member';

interface ServerProps {
  connection: StoredConnection;
  privateKey: CryptoKey | null;
  isActive: boolean;
}

export default function Server({ connection, privateKey, isActive }: ServerProps) {
  const { serverId, serverName, serverIP, accessToken, username } = connection;
  // Destructure stable callbacks from the manager. The full context object
  // changes identity whenever ANY manager state updates, so depending on
  // `manager` itself in useEffect deps would cause infinite loops.
  const {
    claimVoice,
    releaseVoice,
    registerVoiceLeaveHandler,
    unregisterVoiceLeaveHandler,
    registerVoiceActions,
    unregisterVoiceActions,
    setUnreadCount,
    setVoiceStatus,
    removeConnection,
  } = useConnectionManager();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedTextChannelId, setSelectedTextChannelId] = useState<string | null>(null);
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voicePeers, setVoicePeers] = useState<Record<string, string[]>>({});
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('voiceMuted') === 'true');
  const [speakingLevels, setSpeakingLevels] = useState<Map<string, number>>(new Map());
  const [peerPings, setPeerPings] = useState<Record<string, number>>({});
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [videoTracks, setVideoTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [screenTracks, setScreenTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [screenAudioUsers, setScreenAudioUsers] = useState<Set<string>>(new Set());
  const [focusedVideoUsers, setFocusedVideoUsers] = useState<Set<string>>(new Set());
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string | null>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [selfMutedUsers, setSelfMutedUsers] = useState<Set<string>>(new Set());
  const [deafenedUsers, setDeafenedUsers] = useState<Set<string>>(new Set());
  const [isDeafened, setIsDeafened] = useState(() => localStorage.getItem('voiceDeafened') === 'true');
  const [voicePeerSettings, setVoicePeerSettings] = useState<Record<string, { volume: number; muted: boolean }>>({});
  const [screenAudioPeerSettings, setScreenAudioPeerSettings] = useState<Record<string, { volume: number; muted: boolean }>>({});
  const [myRole, setMyRole] = useState<Role>('member');
  const [userRoles, setUserRoles] = useState<Record<string, Role>>({});
  const [nameColors, setNameColors] = useState<Record<string, string | null>>({});
  const [settings, setSettings] = useState<UserSettings>(() => loadCachedSettings());
  const settingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<Partial<UserSettings>>({});
  const { setTheme } = useTheme();
  useCustomThemeVars(settings.customThemeColors, settings.theme === CUSTOM_THEME_ID);
  // Short-lived upload-scoped token used as ?token=... on image URLs so the
  // long-lived session JWT never touches a URL (and therefore never ends up
  // in access logs or browser history). Auto-refreshed below.
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);
  const {
    selectedDmPartner, setSelectedDmPartner,
    dmConversations, setDmConversations,
    publicKeys, setPublicKeys,
    startDm: startDmRaw, handleIncomingDm,
  } = useDmState(username, privateKey);
  const wsRef = useRef<WebSocket | null>(null);
  const voiceRef = useRef<VoiceClient | null>(null);
  const rcClientRef = useRef<RemoteControlClient | null>(null);
  const [rcSession, setRcSession] = useState<RemoteControlSession | null>(null);
  const [rcPendingRequest, setRcPendingRequest] = useState<string | null>(null);
  const voicePeerSettingsRef = useRef(voicePeerSettings);
  voicePeerSettingsRef.current = voicePeerSettings;
  const screenAudioPeerSettingsRef = useRef(screenAudioPeerSettings);
  screenAudioPeerSettingsRef.current = screenAudioPeerSettings;
  const { unreadCounts, initUnreads, incrementUnread, clearUnread, notify } = useNotifications();
  const selectedTextChannelIdRef = useRef(selectedTextChannelId);
  selectedTextChannelIdRef.current = selectedTextChannelId;
  const selectedDmPartnerRef = useRef(selectedDmPartner);
  selectedDmPartnerRef.current = selectedDmPartner;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const windowFocusedRef = useRef(
    typeof document !== "undefined"
      ? document.visibilityState === "visible" && document.hasFocus()
      : true,
  );
  const readDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const didAutoSelectRef = useRef(false);

  // Per-channel/DM message cache so switching back to a visited conversation
  // renders instantly. Live WS messages update it; reconnects fetch ?after=<id>
  // to fill any gap; LRU-evicts the oldest non-active conversation past max.
  const messageCacheRef = useRef<MessageCacheStore>(new MessageCacheStore(10));
  const [cacheVersion, setCacheVersion] = useState(0);
  const bumpCache = useCallback(() => setCacheVersion((v) => v + 1), []);
  const currentCacheKeyRef = useRef<string | null>(null);
  currentCacheKeyRef.current = selectedDmPartner
    ? dmKey(selectedDmPartner)
    : selectedTextChannelId
      ? channelKey(selectedTextChannelId)
      : null;
  const [wsStatus, setWsStatus] = useState<'open' | 'reconnecting'>('open');

  const protocol = getProtocol(serverIP);

  // Debounced read-marker update. Clears the local unread count immediately
  // for a snappy UI, then schedules a single trailing PUT per target so a
  // burst of incoming messages collapses into one server write.
  const markRead = useCallback((targetId: string) => {
    clearUnread(targetId);
    const timers = readDebounceRef.current;
    const existing = timers.get(targetId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      timers.delete(targetId);
      fetch(`${protocol}://${serverIP}/read/${targetId}`, {
        method: 'PUT', headers: { 'access-token': accessToken },
      }).catch(() => {});
    }, 500);
    timers.set(targetId, handle);
  }, [protocol, serverIP, accessToken, clearUnread]);

  // Fetch channels and set up WebSocket
  useEffect(() => {
    const wsProtocol = getWsProtocol(serverIP);

    fetch(`${protocol}://${serverIP}/channels`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setChannels(data.channels);
        const firstText = data.channels.find((c: Channel) => c.type === "text");
        if (firstText && !didAutoSelectRef.current) {
          didAutoSelectRef.current = true;
          setSelectedTextChannelId(firstText.__id);
          markRead(firstText.__id);
        }
      });

    fetch(`${protocol}://${serverIP}/users`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setAllUsers(data.users.map((u: { username: string }) => u.username));
        const photos: Record<string, string | null> = {};
        const roles: Record<string, Role> = {};
        const keys: Record<string, string> = {};
        const colors: Record<string, string | null> = {};
        data.users.forEach((u: { username: string; profilePhoto: string | null; role: Role; publicKey: string | null; nameColor: string | null }) => {
          photos[u.username] = u.profilePhoto;
          roles[u.username] = u.role || 'member';
          colors[u.username] = u.nameColor || null;
          if (u.publicKey) keys[u.username] = u.publicKey;
        });
        setProfilePhotos(photos);
        setUserRoles(roles);
        setNameColors(colors);
        setPublicKeys(keys);
      });

    fetch(`${protocol}://${serverIP}/me`, {
      method: 'POST',
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setMyRole((data.role as Role) || 'member');
        setNameColors((prev) => ({ ...prev, [username]: data.nameColor || null }));
      });

    fetch(`${protocol}://${serverIP}/me/voice-peer-settings`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setVoicePeerSettings(data.voicePeerSettings || {}));

    fetch(`${protocol}://${serverIP}/me/settings`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        const cached = loadCachedSettings();
        const merged: UserSettings = { ...DEFAULT_SETTINGS, ...cached, ...(data.settings || {}) };
        setSettings(merged);
        cacheSettings(merged);
        applyVoiceSettings(voiceRef.current, merged);
        setTheme(merged.theme);
      })
      .catch(() => {});

    fetch(`${protocol}://${serverIP}/me/screen-audio-peer-settings`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setScreenAudioPeerSettings(data.screenAudioPeerSettings || {}));

    fetch(`${protocol}://${serverIP}/dm/conversations`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setDmConversations(data.conversations || []));

    fetch(`${protocol}://${serverIP}/unread-counts`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => initUnreads(data.unreads || {}));

    let unmounting = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let firstConnect = true;

    // Handle server pushes for voice state and presence
    const handleServerMessages = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'voice-state') {
        setVoicePeers(msg.voicePeers);
        if (msg.mutedUsers) setSelfMutedUsers(new Set(msg.mutedUsers));
        if (msg.deafenedUsers) setDeafenedUsers(new Set(msg.deafenedUsers));
      }
      if (msg.type === 'mute-state') {
        setSelfMutedUsers((prev) => {
          const next = new Set(prev);
          if (msg.muted) next.add(msg.username);
          else next.delete(msg.username);
          return next;
        });
      }
      if (msg.type === 'deafen-state') {
        setDeafenedUsers((prev) => {
          const next = new Set(prev);
          if (msg.deafened) next.add(msg.username);
          else next.delete(msg.username);
          return next;
        });
      }
      if (msg.type === 'presence') {
        setOnlineUsers(new Set(msg.onlineUsers));
        // If there are online users we haven't seen, re-fetch the full user list
        setAllUsers((prev) => {
          const known = new Set(prev);
          const hasNew = msg.onlineUsers.some((u: string) => !known.has(u));
          if (hasNew) {
            fetch(`${protocol}://${serverIP}/users`, {
              headers: { 'access-token': accessToken },
            })
              .then((res) => res.json())
              .then((data) => {
                setAllUsers(data.users.map((u: { username: string }) => u.username));
                const photos: Record<string, string | null> = {};
                data.users.forEach((u: { username: string; profilePhoto: string | null }) => {
                  photos[u.username] = u.profilePhoto;
                });
                setProfilePhotos(photos);
              });
          }
          return prev;
        });
      }
      if (msg.type === 'user-key' && typeof msg.username === 'string' && typeof msg.publicKey === 'string') {
        setPublicKeys((prev) => {
          if (prev[msg.username] === msg.publicKey) return prev;
          return { ...prev, [msg.username]: msg.publicKey };
        });
      }
      if (msg.type === 'voice-pings') {
        setPeerPings(msg.pings);
      }
      if (msg.type === 'role-changed') {
        setUserRoles((prev) => ({ ...prev, [msg.username]: msg.role }));
        if (msg.username === username) setMyRole(msg.role);
      }
      if (msg.type === 'name-color-changed') {
        setNameColors((prev) => ({ ...prev, [msg.username]: msg.nameColor }));
      }
      if (msg.type === 'text-message') {
        // Keep cache live for any cached channel (including the active one and
        // messages the user sent — the server echoes self-sent back to us).
        const key = channelKey(msg.channelId);
        if (messageCacheRef.current.has(key)) {
          messageCacheRef.current.appendMessage(key, msg, currentCacheKeyRef.current ?? undefined);
          bumpCache();
        }
        if (msg.sender !== username) {
          const activelyViewing =
            msg.channelId === selectedTextChannelIdRef.current &&
            windowFocusedRef.current;
          if (activelyViewing) {
            markRead(msg.channelId);
          } else {
            incrementUnread(msg.channelId);
            const ch = channelsRef.current.find((c) => c.__id === msg.channelId);
            notify(`#${ch?.name ?? 'channel'}`, `${msg.sender}: ${msg.messageContent}`);
          }
        }
      }
      if (msg.type === 'delete-message') {
        messageCacheRef.current.removeMessageEverywhere(msg.messageId);
        bumpCache();
      }
      if (msg.type === 'dm-message') {
        handleIncomingDm(msg);
        const partner = msg.sender === username ? msg.recipient : msg.sender;
        const key = dmKey(partner);
        const cached = messageCacheRef.current.peek(key);
        if (cached?.sharedKey) {
          // Decrypt using the cached shared key so cached-but-not-viewed DMs
          // stay fresh for when the user returns.
          decrypt(cached.sharedKey, msg.iv, msg.ciphertext)
            .then((text) => {
              messageCacheRef.current.appendMessage(
                key,
                {
                  __id: msg.__id,
                  sender: msg.sender,
                  text,
                  timestamp: msg.timestamp,
                  attachments: msg.attachments || [],
                  replyToId: msg.replyToId ?? null,
                },
                currentCacheKeyRef.current ?? undefined,
              );
              bumpCache();
            })
            .catch(() => {});
        }
        if (msg.sender !== username) {
          const activelyViewing =
            partner === selectedDmPartnerRef.current && windowFocusedRef.current;
          if (activelyViewing) {
            markRead(partner);
          } else {
            incrementUnread(partner);
            notify(`DM from ${msg.sender}`, 'New message');
          }
        }
      }
      if (msg.type === 'dm-delete-message') {
        messageCacheRef.current.removeMessageEverywhere(msg.messageId);
        bumpCache();
      }
      if (msg.type === 'user-banned') {
        setAllUsers((prev) => prev.filter((u) => u !== msg.username));
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(msg.username);
          return next;
        });
        setUserRoles((prev) => {
          const next = { ...prev };
          delete next[msg.username];
          return next;
        });
      }
    };

    const fetchMissedForCachedConversations = async () => {
      const entries: Array<[string, ChannelCacheEntry]> = [];
      messageCacheRef.current.forEach((k, v) => entries.push([k, v]));
      for (const [key, entry] of entries) {
        const last = entry.messages[entry.messages.length - 1];
        if (!last?.__id) continue;
        const url = key.startsWith('ch:')
          ? `${protocol}://${serverIP}/channels/${key.slice(3)}/messages?after=${last.__id}`
          : `${protocol}://${serverIP}/dm/messages/${encodeURIComponent(key.slice(3))}?after=${last.__id}`;
        try {
          const res = await fetch(url, { headers: { 'access-token': accessToken } });
          if (!res.ok) { messageCacheRef.current.invalidate(key); continue; }
          const data = await res.json();
          if (data.hasMore) {
            // More than the cap was missed — drop the cache entry so the
            // next view does a fresh fetch-from-latest.
            messageCacheRef.current.invalidate(key);
            continue;
          }
          if (key.startsWith('dm:')) {
            if (!entry.sharedKey) { messageCacheRef.current.invalidate(key); continue; }
            const decrypted: any[] = [];
            for (const m of data.messages) {
              try {
                const text = await decrypt(entry.sharedKey, m.iv, m.ciphertext);
                decrypted.push({
                  __id: m.__id, sender: m.sender, text, timestamp: m.timestamp,
                  attachments: m.attachments || [], replyToId: m.replyToId ?? null,
                });
              } catch { /* skip */ }
            }
            messageCacheRef.current.appendMany(key, decrypted, currentCacheKeyRef.current ?? undefined);
          } else {
            messageCacheRef.current.appendMany(key, data.messages, currentCacheKeyRef.current ?? undefined);
          }
        } catch {
          // Network error — leave the cache as-is; live WS updates will
          // eventually fill the gap for messages that arrive from now on.
        }
      }
      bumpCache();
    };

    const connect = () => {
      const ws = new WebSocket(`${wsProtocol}://${serverIP}?token=${accessToken}`);
      wsRef.current = ws;

      // Re-initialize the voice client on each (re)connect — VoiceClient
      // captures its WebSocket in its constructor, so a fresh socket needs a
      // fresh VoiceClient. The old one, if any, is destroyed first.
      voiceRef.current?.destroy();
      rcClientRef.current?.destroy();
      setRcSession(null);
      setRcPendingRequest(null);
      rcClientRef.current = new RemoteControlClient(ws, username, {
        onIncomingRequest: (requester) => {
          // Silently decline when the user has disabled inbound control
          // requests in settings — no dialog, no sound.
          if (localStorage.getItem('rcAllowIncoming') === 'false') {
            rcClientRef.current?.respond(requester, false).catch(() => {});
            return;
          }
          setRcPendingRequest(requester);
        },
        onSessionChange: (session) => {
          setRcSession(session);
        },
        onRequestDenied: (sharer) => {
          window.electronAPI?.showNotification('Request denied', `${sharer} denied your control request.`);
        },
        onError: (message) => {
          console.warn('[remote-control]', message);
        },
      });
      const cachedSettings = loadCachedSettings();
      voiceRef.current = new VoiceClient(ws, {
        onPeerJoined: (channelId, user) => {
          setVoicePeers((prev) => {
            const current = prev[channelId] || [];
            if (current.includes(user)) return prev;
            return { ...prev, [channelId]: [...current, user] };
          });
          // Record the saved base volume/mute immediately; VoiceClient stores it
          // and re-applies when the consumer/gain node is actually created.
          const s = voicePeerSettingsRef.current[user];
          if (s) {
            voiceRef.current?.setUserVolume(user, s.volume);
            voiceRef.current?.setUserMuted(user, s.muted);
          }
        },
        onPeerLeft: (channelId, user) => {
          setVoicePeers((prev) => ({
            ...prev,
            [channelId]: (prev[channelId] || []).filter((u) => u !== user),
          }));
        },
        onLevelChange: (user, level) => {
          setSpeakingLevels((prev) => {
            const next = new Map(prev);
            if (level < 0.02) next.delete(user);
            else next.set(user, level);
            return next;
          });
        },
        onVideoTrack: (user, track) => {
          setVideoTracks((prev) => {
            const next = new Map(prev);
            if (track) next.set(user, track);
            else {
              next.delete(user);
              setFocusedVideoUsers((prev) => {
                const key = `camera:${user}`;
                if (!prev.has(key)) return prev;
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }
            return next;
          });
        },
        onScreenTrack: (user, track) => {
          setScreenTracks((prev) => {
            const next = new Map(prev);
            if (track) next.set(user, track);
            else {
              next.delete(user);
              setFocusedVideoUsers((prev) => {
                const key = `screen:${user}`;
                if (!prev.has(key)) return prev;
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }
            return next;
          });
          // Sync isScreenSharing for local user
          if (user === username) {
            setIsScreenSharing(!!track);
            // End any active session + clear stored display bounds in main.
            if (!track) rcClientRef.current?.screenShareStopped();
          }
        },
        onSessionSuperseded: () => {
          voiceRef.current?.leave(false);
          setVoiceChannelId(null);
        },
        onScreenAudioChange: (user, available) => {
          setScreenAudioUsers((prev) => {
            const next = new Set(prev);
            if (available) next.add(user);
            else next.delete(user);
            return next;
          });
          if (available) {
            const s = screenAudioPeerSettingsRef.current[user];
            if (s) {
              voiceRef.current?.setScreenAudioVolume(user, s.volume);
              voiceRef.current?.setScreenAudioMuted(user, s.muted);
            }
          }
        },
      });
      // Apply cached settings immediately so the first call uses last-known
      // values. The /me/settings fetch above will overwrite when it resolves.
      applyVoiceSettings(voiceRef.current, cachedSettings);

      ws.addEventListener('open', () => {
        attempt = 0;
        setWsStatus('open');
        if (!firstConnect) {
          void fetchMissedForCachedConversations();
        }
        firstConnect = false;
      });

      ws.addEventListener('close', () => {
        if (unmounting) return;
        setWsStatus('reconnecting');
        // Server drops the user from voice on disconnect; reflect in the UI.
        setVoiceChannelId(null);
        setVoicePeers({});
        setSpeakingLevels(new Map());
        setVideoTracks(new Map());
        setScreenTracks(new Map());
        setScreenAudioUsers(new Set());
        setFocusedVideoUsers(new Set());
        // Server already revokes rc sessions on disconnect; just mirror state.
        setRcSession(null);
        setRcPendingRequest(null);
        // Exponential backoff capped at 30s, with ±20% jitter so a mass
        // reconnect (e.g., server restart) doesn't thundering-herd.
        const base = Math.min(30_000, 500 * 2 ** attempt++);
        const jitter = base * (0.8 + Math.random() * 0.4);
        reconnectTimer = setTimeout(connect, jitter);
      });

      ws.addEventListener('message', handleServerMessages);
    };

    connect();

    return () => {
      unmounting = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      voiceRef.current?.leave();
      voiceRef.current?.destroy();
      rcClientRef.current?.destroy();
      rcClientRef.current = null;
      wsRef.current?.close();
    };
  }, [serverIP, accessToken]);

  const joinVoiceChannel = useCallback(async (channelId: string) => {
    setLeftSheetOpen(false);
    if (voiceChannelId === channelId) return;
    // Global voice lock: ask any other server currently in voice to leave first.
    await claimVoice(serverId);
    if (voiceChannelId) await voiceRef.current?.leave();
    await voiceRef.current?.join(channelId, username);
    setVoiceChannelId(channelId);
    setIsCameraOn(false);
    setIsScreenSharing(false);

    // Restore persisted mute/deafen state
    const wasMuted = localStorage.getItem('voiceMuted') === 'true';
    const wasDeafened = localStorage.getItem('voiceDeafened') === 'true';
    setIsMuted(wasMuted);
    setIsDeafened(wasDeafened);
    if (wasMuted) voiceRef.current?.toggleMute();
    if (wasDeafened) voiceRef.current?.setDeafened(true);
    wsRef.current?.send(JSON.stringify({ type: 'mute-state', muted: wasMuted }));
    wsRef.current?.send(JSON.stringify({ type: 'deafen-state', deafened: wasDeafened }));

    // Record saved volume/mute for every existing peer; VoiceClient stores
    // the base value and applies it the moment each consumer's gain node exists.
    for (const [user, s] of Object.entries(voicePeerSettingsRef.current)) {
      voiceRef.current?.setUserVolume(user, s.volume);
      voiceRef.current?.setUserMuted(user, s.muted);
    }
  }, [voiceChannelId, username, claimVoice, serverId]);

  const leaveVoiceChannel = useCallback(async () => {
    await voiceRef.current?.leave();
    setVoiceChannelId(null);
    setIsCameraOn(false);
    setIsScreenSharing(false);
    setScreenTracks(new Map());
    setVideoTracks(new Map());
    setScreenAudioUsers(new Set());
    setFocusedVideoUsers(new Set());
    // Mute/deafen state intentionally NOT reset — persisted via localStorage
    releaseVoice(serverId);
  }, [releaseVoice, serverId]);

  // ─── Upload token lifecycle ─────────────────────────────────────────────────

  // Fetch a short-lived upload token and refresh it before it expires. Also
  // re-fetch when the tab becomes visible again, to cover the long-sleep case
  // (laptop closed for an hour, then reopened) where the interval timer has
  // drifted and any in-flight image loads would otherwise 401.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      try {
        const res = await fetch(`${protocol}://${serverIP}/upload-token`, {
          method: 'POST',
          headers: { 'access-token': accessToken },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setUploadToken(data.uploadToken);
        // Refresh at 80% of TTL so we have a ~2 min buffer on a 10 min token.
        const ttlMs = (data.expiresIn ?? 600) * 1000;
        const refreshMs = Math.max(60_000, ttlMs * 0.8);
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, refreshMs);
      } catch { /* will retry on next visibilitychange */ }
    }

    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [protocol, serverIP, accessToken]);

  // ─── Connection manager integration ────────────────────────────────────────

  // Register our leave handler so other servers can force us off voice when
  // they claim the global voice lock. Unregister on unmount (disconnect).
  useEffect(() => {
    registerVoiceLeaveHandler(serverId, leaveVoiceChannel);
    return () => {
      unregisterVoiceLeaveHandler(serverId);
      unregisterVoiceActions(serverId);
      releaseVoice(serverId);
    };
  }, [
    registerVoiceLeaveHandler,
    unregisterVoiceLeaveHandler,
    unregisterVoiceActions,
    releaseVoice,
    serverId,
    leaveVoiceChannel,
  ]);

  // Aggregate this server's unread total and push it to the rail.
  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((a, b) => a + b, 0),
    [unreadCounts],
  );
  useEffect(() => {
    setUnreadCount(serverId, totalUnread);
  }, [setUnreadCount, serverId, totalUnread]);

  // Track window focus/visibility. A channel is considered "actively viewed"
  // only when it's selected AND the window is focused — so blurred-but-on-
  // general should still notify, and refocusing should clear unreads that
  // piled up while away.
  useEffect(() => {
    const update = () => {
      const focused =
        document.visibilityState === "visible" && document.hasFocus();
      const wasFocused = windowFocusedRef.current;
      windowFocusedRef.current = focused;
      if (focused && !wasFocused) {
        const channelId = selectedTextChannelIdRef.current;
        const partner = selectedDmPartnerRef.current;
        if (channelId) markRead(channelId);
        else if (partner) markRead(partner);
      }
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [markRead]);

  // Flush any pending debounced read PUTs on unmount (server disconnect).
  useEffect(() => {
    const timers = readDebounceRef.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  // Publish voice status + actions whenever we hold an active voice session.
  const currentVoiceChannelName = useMemo(
    () => channels.find((c) => c.__id === voiceChannelId)?.name ?? "",
    [channels, voiceChannelId],
  );
  useEffect(() => {
    if (!voiceChannelId) {
      setVoiceStatus(serverId, null);
      unregisterVoiceActions(serverId);
      return;
    }
    setVoiceStatus(serverId, {
      channelId: voiceChannelId,
      channelName: currentVoiceChannelName,
      isMuted,
      isDeafened,
      isCameraOn,
      isScreenSharing,
    });
  }, [
    setVoiceStatus,
    unregisterVoiceActions,
    serverId,
    voiceChannelId,
    currentVoiceChannelName,
    isMuted,
    isDeafened,
    isCameraOn,
    isScreenSharing,
  ]);

  const toggleMute = useCallback(() => {
    const muted = voiceRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
    localStorage.setItem('voiceMuted', String(muted));
    wsRef.current?.send(JSON.stringify({ type: 'mute-state', muted }));
  }, []);

  const toggleDeafen = useCallback(() => {
    const next = !isDeafened;
    setIsDeafened(next);
    localStorage.setItem('voiceDeafened', String(next));
    voiceRef.current?.setDeafened(next);
    wsRef.current?.send(JSON.stringify({ type: 'deafen-state', deafened: next }));
    // Deafening also mutes you (like Discord)
    if (next && !isMuted) {
      const muted = voiceRef.current?.toggleMute() ?? false;
      setIsMuted(muted);
      localStorage.setItem('voiceMuted', String(muted));
      wsRef.current?.send(JSON.stringify({ type: 'mute-state', muted: true }));
    }
    // Undeafening does NOT auto-unmute — user must unmute manually
  }, [isDeafened, isMuted]);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      await voiceRef.current?.stopVideo();
    } else {
      await voiceRef.current?.startVideo();
    }
    setIsCameraOn(!isCameraOn);
  }, [isCameraOn]);

  const startScreenShare = useCallback(async (settings: ScreenShareSettings) => {
    await voiceRef.current?.startScreenShare(settings);
  }, []);

  const stopScreenShare = useCallback(async () => {
    await voiceRef.current?.stopScreenShare();
  }, []);

  const requestRemoteControl = useCallback((sharerUsername: string) => {
    rcClientRef.current?.requestControl(sharerUsername);
  }, []);

  const sendRemoteInput = useCallback((event: RemoteControlInputEvent) => {
    rcClientRef.current?.sendInput(event);
  }, []);

  const releaseRemoteControl = useCallback(() => {
    rcClientRef.current?.revoke('stopped');
  }, []);

  const respondRemoteControl = useCallback((requester: string, granted: boolean) => {
    rcClientRef.current?.respond(requester, granted);
  }, []);

  // Register voice actions with the manager so the CrossServerVoiceBar can
  // control this server's voice session from another server's view.
  useEffect(() => {
    if (!voiceChannelId) return;
    registerVoiceActions(serverId, {
      toggleMute,
      toggleDeafen,
      toggleCamera,
      leave: leaveVoiceChannel,
    });
  }, [registerVoiceActions, serverId, voiceChannelId, toggleMute, toggleDeafen, toggleCamera, leaveVoiceChannel]);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    cacheSettings(partial);
    pendingSettingsRef.current = { ...pendingSettingsRef.current, ...partial };
    if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    settingsDebounceRef.current = setTimeout(() => {
      const body = pendingSettingsRef.current;
      pendingSettingsRef.current = {};
      settingsDebounceRef.current = null;
      fetch(`${protocol}://${serverIP}/me/settings`, {
        method: 'PUT',
        headers: { "access-token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, 500);
  }, [protocol, serverIP, accessToken]);

  const saveVoicePeerSetting = useCallback((peerUsername: string, volume: number, muted: boolean) => {
    fetch(`${protocol}://${serverIP}/me/voice-peer-settings`, {
      method: 'PUT',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ peerUsername, volume, muted }),
    });
  }, [serverIP, accessToken, protocol]);

  const handleUserVolume = useCallback((user: string, volume: number) => {
    voiceRef.current?.setUserVolume(user, volume);
    setVoicePeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, volume };
      saveVoicePeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveVoicePeerSetting]);

  const handleUserMute = useCallback((user: string, muted: boolean) => {
    voiceRef.current?.setUserMuted(user, muted);
    setVoicePeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, muted };
      saveVoicePeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveVoicePeerSetting]);

  const saveScreenAudioPeerSetting = useCallback((peerUsername: string, volume: number, muted: boolean) => {
    fetch(`${protocol}://${serverIP}/me/screen-audio-peer-settings`, {
      method: 'PUT',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ peerUsername, volume, muted }),
    });
  }, [serverIP, accessToken, protocol]);

  const handleScreenAudioVolume = useCallback((user: string, volume: number) => {
    voiceRef.current?.setScreenAudioVolume(user, volume);
    setScreenAudioPeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, volume };
      saveScreenAudioPeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveScreenAudioPeerSetting]);

  const handleScreenAudioMute = useCallback((user: string, muted: boolean) => {
    voiceRef.current?.setScreenAudioMuted(user, muted);
    setScreenAudioPeerSettings((prev) => {
      const setting = { ...prev[user] || { volume: 1, muted: false }, muted };
      saveScreenAudioPeerSetting(user, setting.volume, setting.muted);
      return { ...prev, [user]: setting };
    });
  }, [saveScreenAudioPeerSetting]);

  const banUser = useCallback((target: string) => {
    fetch(`${protocol}://${serverIP}/users/${target}/ban`, {
      method: 'POST',
      headers: { "access-token": accessToken },
    });
  }, [protocol, serverIP, accessToken]);

  const setUserRole = useCallback((target: string, role: Role) => {
    fetch(`${protocol}://${serverIP}/users/${target}/role`, {
      method: 'PUT',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }, [protocol, serverIP, accessToken]);

  const createChannel = useCallback(async (name: string, type: "text" | "voice") => {
    const res = await fetch(`${protocol}://${serverIP}/channels`, {
      method: 'POST',
      headers: { "access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    });
    if (!res.ok) return;
    const { channel } = await res.json();
    setChannels((prev) => [...prev, channel]);
    if (type === "text") setSelectedTextChannelId(channel.__id);
  }, [protocol, serverIP, accessToken]);

  const startDm = useCallback((partner: string) => {
    setLeftSheetOpen(false);
    setRightSheetOpen(false);
    startDmRaw(partner);
    setSelectedTextChannelId(null);
    markRead(partner);
  }, [startDmRaw, markRead]);

  const selectTextChannel = useCallback((channelId: string) => {
    setLeftSheetOpen(false);
    setSelectedTextChannelId(channelId);
    setSelectedDmPartner(null);
    markRead(channelId);
  }, [markRead, setSelectedDmPartner]);

  const selectedTextChannel = channels.find((c) => c.__id === selectedTextChannelId);
  const currentVoiceChannel = channels.find((c) => c.__id === voiceChannelId);

  const mobileTitle = selectedDmPartner
    ? `@ ${selectedDmPartner}`
    : selectedTextChannel
      ? `# ${selectedTextChannel.name}`
      : serverName;

  const channelSidebarStack = (
    <>
      <div className="p-4 border-b font-bold text-center shrink-0 min-w-0">
        <div className="truncate">{serverName}</div>
      </div>
      <ChannelSidebar
        channels={channels}
        selectedTextChannelId={selectedTextChannelId}
        unreadCounts={unreadCounts}
        voiceChannelId={voiceChannelId}
        voicePeers={voicePeers}
        speakingLevels={speakingLevels}
        peerPings={peerPings}
        videoTracks={videoTracks}
        screenTracks={screenTracks}
        screenAudioUsers={screenAudioUsers}
        focusedFeeds={focusedVideoUsers}
        onSelectTextChannel={selectTextChannel}
        dmConversations={dmConversations}
        selectedDmPartner={selectedDmPartner}
        onSelectDm={startDm}
        profilePhotos={profilePhotos}
        serverIP={serverIP}
        uploadToken={uploadToken}
        screenAudioPeerSettings={screenAudioPeerSettings}
        onScreenAudioVolume={handleScreenAudioVolume}
        onScreenAudioMute={handleScreenAudioMute}
        localUsername={username}
        selfMutedUsers={selfMutedUsers}
        deafenedUsers={deafenedUsers}
        voicePeerSettings={voicePeerSettings}
        onUserVolume={handleUserVolume}
        onUserMute={handleUserMute}
        onJoinVoiceChannel={joinVoiceChannel}
        canCreateChannel={myRole !== 'member'}
        onCreateChannel={createChannel}
        onFocusVideo={(user) => {
          setFocusedVideoUsers((prev) => {
            const next = new Set(prev);
            if (next.has(user)) next.delete(user);
            else next.add(user);
            return next;
          });
        }}
      />
      {currentVoiceChannel && (
        <VoiceControls
          channelName={currentVoiceChannel.name}
          isMuted={isMuted}
          isDeafened={isDeafened}
          isCameraOn={isCameraOn}
          isScreenSharing={isScreenSharing}
          onToggleMute={toggleMute}
          onToggleDeafen={toggleDeafen}
          onToggleCamera={toggleCamera}
          onStartScreenShare={startScreenShare}
          onStopScreenShare={stopScreenShare}
          onDisconnect={leaveVoiceChannel}
        />
      )}
      <UserPanel
        username={username}
        serverIP={serverIP}
        profilePhoto={profilePhotos[username]}
        accessToken={accessToken}
        uploadToken={uploadToken}
        onProfilePhotoChange={(url) => setProfilePhotos((prev) => ({ ...prev, [username]: url }))}
        nameColor={nameColors[username] ?? null}
        onNameColorChange={(color) => setNameColors((prev) => ({ ...prev, [username]: color }))}
        myRole={myRole}
        totalUsers={allUsers.length}
        onlineCount={onlineUsers.size}
        textChannelCount={channels.filter(c => c.type === "text").length}
        voiceChannelCount={channels.filter(c => c.type === "voice").length}
        onLogout={() => removeConnection(serverId)}
        voiceRef={voiceRef}
        settings={settings}
        updateSettings={updateSettings}
      />
    </>
  );

  const userListSection = (
    <UserList
      users={allUsers}
      onlineUsers={onlineUsers}
      profilePhotos={profilePhotos}
      nameColors={nameColors}
      serverIP={serverIP}
      uploadToken={uploadToken}
      myUsername={username}
      myRole={myRole}
      userRoles={userRoles}
      onBan={banUser}
      onSetRole={setUserRole}
      onStartDm={startDm}
    />
  );

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      style={{ display: isActive ? "flex" : "none" }}
    >
      {isActive && (
        <ActiveSessionBanner session={rcSession} onStop={releaseRemoteControl} />
      )}
      {isActive && (
        <GrantRequestDialog
          requesterUsername={rcPendingRequest}
          onClose={() => setRcPendingRequest(null)}
          onDecide={respondRemoteControl}
        />
      )}
      <div className="flex flex-1 min-h-0">
      <div className="hidden md:flex w-60 border-r flex-col h-full">
        {channelSidebarStack}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="lg:hidden flex items-center gap-2 px-2 py-2 border-b shrink-0">
          <button
            onClick={() => setLeftSheetOpen(true)}
            className="md:hidden p-2 rounded-md hover:bg-accent text-foreground"
            aria-label="Open channels"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="md:hidden flex-1 min-w-0 truncate font-bold text-center">
            {mobileTitle}
          </span>
          <div className="hidden md:block flex-1" />
          <button
            onClick={() => setRightSheetOpen(true)}
            className="p-2 rounded-md hover:bg-accent text-foreground"
            aria-label="Open members"
          >
            <Users className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 relative overflow-hidden">
          {selectedDmPartner ? (
            privateKey && publicKeys[selectedDmPartner] ? (
              <DirectMessage
                serverIP={serverIP}
                partner={selectedDmPartner}
                accessToken={accessToken}
                uploadToken={uploadToken}
                username={username}
                wsRef={wsRef}
                wsStatus={wsStatus}
                profilePhotos={profilePhotos}
                privateKey={privateKey}
                partnerPublicKey={publicKeys[selectedDmPartner]}
                cache={messageCacheRef.current}
                cacheVersion={cacheVersion}
                bumpCache={bumpCache}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                <ShieldAlert className="w-8 h-8" />
                <p className="text-sm font-medium">{selectedDmPartner} hasn't set up encryption yet</p>
                <p className="text-xs">They need to log in again to enable direct messages.</p>
              </div>
            )
          ) : selectedTextChannel ? (
            <TextChannel
              serverIP={serverIP}
              channelId={selectedTextChannel.__id}
              channelName={selectedTextChannel.name}
              accessToken={accessToken}
              uploadToken={uploadToken}
              username={username}
              wsRef={wsRef}
              wsStatus={wsStatus}
              profilePhotos={profilePhotos}
              nameColors={nameColors}
              myRole={myRole}
              onStartDm={startDm}
              cache={messageCacheRef.current}
              cacheVersion={cacheVersion}
              bumpCache={bumpCache}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select a channel
            </div>
          )}
          {isActive && focusedVideoUsers.size > 0 && (() => {
            const focusedTracks = new Map<string, MediaStreamTrack>();
            for (const key of focusedVideoUsers) {
              const [source, user] = key.split(':');
              const trackMap = source === 'screen' ? screenTracks : videoTracks;
              const track = trackMap.get(user);
              if (track) focusedTracks.set(key, track);
            }
            if (focusedTracks.size === 0) return null;
            const controlledKey = rcSession?.role === 'controller'
              ? `screen:${rcSession.sharerUsername}`
              : null;
            return (
              <FocusedVideo
                videoTracks={focusedTracks}
                onRemove={(user) => {
                  setFocusedVideoUsers((prev) => {
                    const next = new Set(prev);
                    next.delete(user);
                    return next;
                  });
                }}
                onCloseAll={() => setFocusedVideoUsers(new Set())}
                controlledKey={controlledKey}
                localUsername={username}
                onSendInput={sendRemoteInput}
                onReleaseControl={releaseRemoteControl}
                onRequestControl={requestRemoteControl}
              />
            );
          })()}
        </div>
      </div>
      <div className="hidden lg:block w-52 border-l h-full">
        {userListSection}
      </div>
      {isActive && (
        <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
          <SheetContent side="left" className="w-80 p-0" title="Servers and channels">
            <div className="flex flex-col h-full">
              <div className="flex gap-2 px-3 py-3 overflow-x-auto border-b shrink-0">
                <ServerRailContent onAfterSelect={() => setLeftSheetOpen(false)} />
              </div>
              <div className="flex flex-col flex-1 min-h-0">
                {channelSidebarStack}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
      {isActive && (
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="w-64 p-0" title="Members">
            <div className="h-full">
              {userListSection}
            </div>
          </SheetContent>
        </Sheet>
      )}
      </div>
    </div>
  );
}
