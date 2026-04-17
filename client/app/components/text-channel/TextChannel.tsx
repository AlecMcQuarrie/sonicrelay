import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { X, FileIcon, Trash2, ArrowDown, Reply, CornerUpLeft, MessageSquare } from "lucide-react";
import MessageHeader from "~/components/ui/message-header";
import MessageInput from "~/components/ui/message-input";
import MessageAttachments from "./MessageAttachments";
import MessageContent from "./MessageContent";
import MessageSkeletons from "./MessageSkeletons";
import Avatar from "~/components/ui/avatar";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "~/components/ui/context-menu";
import { cn } from "~/lib/utils";
import { preloadAllMedia } from "~/lib/preload-media";
import { buildUploadUrl } from "~/lib/protocol";
import { channelKey, type MessageCacheStore } from "~/lib/messageCache";

type Message = {
  __id?: string;
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
  attachments?: string[];
  replyToId?: string | null;
};

interface TextChannelProps {
  serverIP: string;
  channelId: string;
  channelName: string;
  accessToken: string;
  uploadToken: string | null;
  username: string;
  wsRef: React.RefObject<WebSocket | null>;
  wsStatus: 'open' | 'reconnecting';
  profilePhotos: Record<string, string | null>;
  nameColors: Record<string, string | null>;
  myRole: 'superadmin' | 'admin' | 'member';
  onStartDm?: (username: string) => void;
  cache: MessageCacheStore;
  cacheVersion: number;
  bumpCache: () => void;
}

export default function TextChannel({
  serverIP, channelId, channelName, accessToken, uploadToken, username,
  wsRef, wsStatus, profilePhotos, nameColors, myRole, onStartDm,
  cache, cacheVersion, bumpCache,
}: TextChannelProps) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [jumpingToMessage, setJumpingToMessage] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const atBottomRef = useRef(true);
  const prevLatestIdRef = useRef<string | null>(null);
  const prevChannelIdForScrollRef = useRef<string | null>(null);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
  const key = channelKey(channelId);

  // Derive current cache entry. The cacheVersion dep ensures re-read after
  // any cache mutation (live WS message, delete, reply resolve, scroll save).
  const entry = useMemo(() => cache.get(key), [cache, key, cacheVersion]);
  const messages = (entry?.messages ?? []) as Message[];
  const hasMore = entry?.hasMore ?? false;
  const ogCache = entry?.ogCache ?? new Map();
  const replyCache = (entry?.replyCache ?? new Map()) as Map<string, Message | 'deleted'>;
  const initialLoading = !entry;

  // Fetch on cache miss only; cache hits render instantly.
  useEffect(() => {
    if (cache.has(key)) return;
    if (inFlightKeysRef.current.has(key)) return;
    inFlightKeysRef.current.add(key);
    (async () => {
      try {
        const res = await fetch(`${protocol}://${serverIP}/channels/${channelId}/messages?limit=50`, {
          headers: { "access-token": accessToken },
        });
        const data = await res.json();
        const og = await preloadAllMedia(data.messages, protocol, serverIP, accessToken, uploadToken);
        const last = data.messages.length > 0 ? data.messages[data.messages.length - 1] : null;
        cache.set(key, {
          messages: data.messages,
          hasMore: data.hasMore,
          ogCache: og,
          replyCache: new Map(),
          lastSeenMessageId: last?.__id ?? null,
          scrollTop: 0,
        }, key);
        bumpCache();
      } finally {
        inFlightKeysRef.current.delete(key);
      }
    })();
  }, [key, cache, bumpCache, protocol, serverIP, channelId, accessToken, uploadToken]);

  // Reset transient UI when the channel changes (reply draft is per-channel).
  useEffect(() => {
    setReplyingTo(null);
  }, [channelId]);

  // Restore scroll on cache hit. For column-reverse, scrollTop = 0 means bottom,
  // so a fresh entry (never-scrolled) stays at the bottom without extra work.
  // If we land at the bottom, advance lastSeen — otherwise a message that
  // arrived while the channel was backgrounded would leave a stale banner.
  useLayoutEffect(() => {
    if (!entry) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    if (container.scrollTop !== entry.scrollTop) container.scrollTop = entry.scrollTop;
    atBottomRef.current = entry.scrollTop >= -5;
    if (atBottomRef.current) {
      const latest = messages[messages.length - 1]?.__id;
      if (latest && latest !== entry.lastSeenMessageId && cache.has(key)) {
        cache.updateLastSeen(key, latest);
        bumpCache();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, initialLoading]);

  // Auto-scroll to bottom when a new message arrives while the user is pinned
  // to the bottom. Also mark it seen so the "new messages" banner stays hidden.
  const latestId = messages.length > 0 ? messages[messages.length - 1].__id ?? null : null;
  useLayoutEffect(() => {
    if (prevChannelIdForScrollRef.current !== channelId) {
      prevChannelIdForScrollRef.current = channelId;
      prevLatestIdRef.current = latestId;
      return;
    }
    if (!latestId || latestId === prevLatestIdRef.current) return;
    prevLatestIdRef.current = latestId;
    if (!atBottomRef.current) return;
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = 0;
    if (cache.has(key)) {
      cache.updateLastSeen(key, latestId);
      bumpCache();
    }
  }, [channelId, latestId, cache, key, bumpCache]);

  // Load older messages — preload all media, then merge into the cache.
  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMore || messages.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    loadingRef.current = true;
    observerRef.current?.disconnect();

    // Anchor the current first visible message so scroll position is preserved.
    // Capture BEFORE any render/await so layout is stable and the reference is fresh.
    const firstMsgId = messages[0].__id;
    const anchorEl = firstMsgId
      ? container.querySelector(`[data-msg-id="${firstMsgId}"]`) as HTMLElement | null
      : null;
    const anchorOffsetBefore = anchorEl ? anchorEl.getBoundingClientRect().top : null;

    setLoadingMore(true);

    const oldest = messages[0];
    const res = await fetch(
      `${protocol}://${serverIP}/channels/${channelId}/messages?limit=50&before=${oldest.__id}`,
      { headers: { "access-token": accessToken } }
    );
    const data = await res.json();
    const newOgEntries = await preloadAllMedia(data.messages, protocol, serverIP, accessToken, uploadToken);

    flushSync(() => {
      cache.prependPage(key, data.messages, data.hasMore, newOgEntries);
      bumpCache();
      setLoadingMore(false);
    });

    if (anchorEl && anchorOffsetBefore !== null) {
      const anchorOffsetAfter = anchorEl.getBoundingClientRect().top;
      const drift = anchorOffsetAfter - anchorOffsetBefore;
      container.scrollTop += drift;
    }

    loadingRef.current = false;
    requestAnimationFrame(() => {
      const sentinel = sentinelRef.current;
      if (sentinel && observerRef.current) {
        observerRef.current.observe(sentinel);
      }
    });
  }, [hasMore, messages, channelId, accessToken, serverIP, protocol, uploadToken, cache, key, bumpCache]);

  // IntersectionObserver to detect scrolling to the top (oldest messages)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loadingRef.current) loadOlder(); },
      { root: scrollContainerRef.current, threshold: 0 }
    );
    observerRef.current = observer;
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlder]);

  // Track scroll position: toggles jump-to-bottom button AND marks messages as
  // seen whenever the user actually reaches the bottom (clears unread banner).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      atBottomRef.current = container.scrollTop >= -5;
      setShowJumpToBottom(container.scrollTop < -100);
      if (cache.has(key)) cache.updateScrollTop(key, container.scrollTop);
      if (atBottomRef.current) {
        const latest = messages[messages.length - 1]?.__id;
        if (latest && cache.has(key)) {
          cache.updateLastSeen(key, latest);
          bumpCache();
        }
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [messages, cache, key, bumpCache]);

  const jumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTo({ top: 0, behavior: "smooth" });
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    const formData = new FormData();
    for (const file of files) formData.append('files', file);

    const res = await fetch(`${protocol}://${serverIP}/upload`, {
      method: 'POST',
      headers: { "access-token": accessToken },
      body: formData,
    });
    const data = await res.json();
    return data.urls;
  };

  const sendMessage = useCallback(async () => {
    if (!input.trim() && pendingFiles.length === 0) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setUploading(true);
    const attachments = await uploadFiles(pendingFiles);
    setUploading(false);

    wsRef.current.send(JSON.stringify({
      type: 'text-message', channelId, messageContent: input, attachments,
      replyToId: replyingTo?.__id || null,
    }));

    setInput("");
    setPendingFiles([]);
    setReplyingTo(null);
  }, [input, pendingFiles, username, channelId, wsRef, replyingTo]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    e.target.value = "";
  };

  const deleteMessage = (messageId: string) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'delete-message', messageId }));
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Fetch reply targets not already loaded locally or cached
  useEffect(() => {
    if (!entry) return;
    const missingIds = messages
      .filter((m) => m.replyToId && !messages.some((o) => o.__id === m.replyToId) && !replyCache.has(m.replyToId!))
      .map((m) => m.replyToId!);
    const uniqueIds = [...new Set(missingIds)];
    if (uniqueIds.length === 0) return;

    for (const id of uniqueIds) {
      fetch(`${protocol}://${serverIP}/messages/${id}`, {
        headers: { "access-token": accessToken },
      }).then((res) => {
        if (res.status === 404) {
          cache.updateReplyCache(key, id, 'deleted');
          bumpCache();
        } else if (res.ok) {
          return res.json().then((data: Message) => {
            cache.updateReplyCache(key, id, data);
            bumpCache();
          });
        }
      }).catch(() => {});
    }
  }, [messages, replyCache, protocol, serverIP, accessToken, entry, cache, key, bumpCache]);

  const startReply = (msg: Message) => {
    setReplyingTo(msg);
    textareaRef.current?.focus();
  };

  const highlightMessage = useCallback((id: string) => {
    setHighlightedMessageId(id);
    setTimeout(() => setHighlightedMessageId(null), 2000);
  }, []);

  const jumpToMessage = useCallback(async (targetId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const existing = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null;
    if (existing) {
      existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightMessage(targetId);
      return;
    }

    setJumpingToMessage(true);
    loadingRef.current = true;
    observerRef.current?.disconnect();
    container.scrollTo({ top: container.scrollHeight * -1, behavior: 'smooth' });

    let currentMessages = [...messages];
    let moreAvailable = hasMore;
    let found = false;

    while (moreAvailable && !found) {
      const oldest = currentMessages[0];
      if (!oldest?.__id) break;

      const res = await fetch(
        `${protocol}://${serverIP}/channels/${channelId}/messages?limit=50&before=${oldest.__id}`,
        { headers: { "access-token": accessToken } }
      );
      const data = await res.json();
      const newOgEntries = await preloadAllMedia(data.messages, protocol, serverIP, accessToken, uploadToken);

      flushSync(() => {
        cache.prependPage(key, data.messages, data.hasMore, newOgEntries);
        bumpCache();
      });

      currentMessages = [...data.messages, ...currentMessages];
      moreAvailable = data.hasMore;

      if (data.messages.some((m: Message) => m.__id === targetId)) {
        found = true;
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (!found) container.scrollTo({ top: container.scrollHeight * -1, behavior: 'smooth' });
          resolve();
        });
      });
    }

    setJumpingToMessage(false);

    if (found) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null;
          if (el) {
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const offset = elRect.top - containerRect.top - (containerRect.height / 2) + (elRect.height / 2);
            container.scrollTop += offset;
          }
          resolve();
        }));
      });
      highlightMessage(targetId);
    }

    loadingRef.current = false;
    requestAnimationFrame(() => {
      const sentinel = sentinelRef.current;
      if (sentinel && observerRef.current) {
        observerRef.current.observe(sentinel);
      }
    });
  }, [messages, hasMore, channelId, accessToken, serverIP, protocol, uploadToken, highlightMessage, cache, key, bumpCache]);

  // Count of unseen messages since the last "scrolled to bottom" anchor.
  // Drives the new-message banner above the composer on cache-hit revisits
  // (where scroll is restored mid-history) and on live messages while the
  // user is scrolled up reading older history.
  const newMessageCount = useMemo(() => {
    const lastSeen = entry?.lastSeenMessageId;
    if (!lastSeen) return 0;
    let count = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i].__id;
      if (!id || id === lastSeen) break;
      count++;
    }
    return count;
  }, [messages, entry?.lastSeenMessageId]);

  const reconnecting = wsStatus === 'reconnecting';
  const canSend = (!!input.trim() || pendingFiles.length > 0) && !uploading && !reconnecting;

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Channel header */}
      <MessageHeader><span className="truncate min-w-0"># {channelName}</span></MessageHeader>

      {/* Messages — column-reverse keeps viewport anchored to bottom */}
      {initialLoading ? (
        <div className="flex-1 overflow-hidden flex flex-col justify-end">
          <MessageSkeletons />
        </div>
      ) : (
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col-reverse">
        <div className="space-y-2 min-w-0 w-full">
          {/* Sentinel for loading older messages */}
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {loadingMore && (
            <div className="text-center text-sm text-muted-foreground py-2">Loading older messages...</div>
          )}
          {messages.map((msg, i) => {
            const photo = profilePhotos[msg.sender];
            const photoUrl = photo && uploadToken ? buildUploadUrl(photo, serverIP, uploadToken) : null;

            // Resolve the reply target from loaded messages or cache
            const replyTarget = msg.replyToId
              ? messages.find((m) => m.__id === msg.replyToId) || replyCache.get(msg.replyToId) || null
              : null;

            return (
            <ContextMenu key={msg.__id || i}>
              <ContextMenuTrigger asChild>
                <div data-msg-id={msg.__id} className={cn(
                  "min-w-0 group flex gap-2 items-start rounded-md px-1 -mx-1 transition-colors duration-700 cursor-pointer hover:bg-accent/50",
                  highlightedMessageId === msg.__id && "bg-primary/15"
                )}>
                  <Avatar username={msg.sender} profilePhoto={photoUrl} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    {/* Reply quote */}
                    {msg.replyToId && (
                      <div
                        onClick={() => {
                          if (replyTarget && replyTarget !== 'deleted') jumpToMessage(msg.replyToId!);
                        }}
                        className={cn(
                          "flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5 min-w-0",
                          replyTarget && replyTarget !== 'deleted'
                            ? "cursor-pointer hover:text-foreground transition-colors"
                            : "cursor-default"
                        )}
                      >
                        <CornerUpLeft className="w-3 h-3 shrink-0" />
                        {replyTarget === 'deleted' ? (
                          <span className="italic truncate min-w-0">Original message was deleted</span>
                        ) : replyTarget ? (
                          <>
                            <span className="font-semibold truncate min-w-0 shrink">{replyTarget.sender}</span>
                            <span className="truncate min-w-0 max-w-60">
                              {replyTarget.messageContent
                                ? replyTarget.messageContent.length > 60
                                  ? replyTarget.messageContent.slice(0, 60) + '...'
                                  : replyTarget.messageContent
                                : 'Click to see attachment'}
                            </span>
                          </>
                        ) : (
                          <span className="italic">Loading...</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span
                        className="font-bold truncate min-w-0"
                        style={nameColors[msg.sender] ? { color: nameColors[msg.sender]! } : undefined}
                      >
                        {msg.sender}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {msg.messageContent && (
                      <MessageContent
                        text={msg.messageContent}
                        serverIP={serverIP}
                        accessToken={accessToken}
                        ogCache={ogCache}
                      />
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <MessageAttachments attachments={msg.attachments} serverIP={serverIP} uploadToken={uploadToken} />
                    )}
                  </div>
                  <div className="flex gap-0.5 shrink-0 mt-1">
                    {msg.__id && (
                      <button
                        onClick={() => startReply(msg)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <Reply className="w-4 h-4" />
                      </button>
                    )}
                    {(msg.sender === username || myRole !== 'member') && msg.__id && (
                      <button
                        onClick={() => deleteMessage(msg.__id!)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => startReply(msg)} className="cursor-pointer">
                  <Reply className="w-4 h-4 mr-2" />
                  Reply
                </ContextMenuItem>
                {onStartDm && msg.sender !== username && (
                  <ContextMenuItem onSelect={() => onStartDm(msg.sender)} className="cursor-pointer">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Message
                  </ContextMenuItem>
                )}
                {(msg.sender === username || myRole !== 'member') && msg.__id && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => deleteMessage(msg.__id!)} className="cursor-pointer text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
            );
          })}
        </div>

        {/* Jumping to message overlay */}
        {jumpingToMessage && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm shadow-lg">
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Jumping to message...
            </div>
          </div>
        )}

        {/* Jump to bottom button */}
        {showJumpToBottom && !jumpingToMessage && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none">
            <button
              onClick={jumpToBottom}
              className="pointer-events-auto flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm shadow-lg hover:bg-primary/90 transition-colors"
            >
              <ArrowDown className="w-4 h-4" />
              Jump to bottom
            </button>
          </div>
        )}
      </div>
      )}

      {/* New messages banner */}
      {newMessageCount > 0 && (
        <button
          onClick={jumpToBottom}
          className="mx-4 mt-1 flex items-center justify-center gap-1.5 px-3 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors cursor-pointer"
        >
          <ArrowDown className="w-3 h-3" />
          {newMessageCount} new message{newMessageCount === 1 ? '' : 's'}
        </button>
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="px-4 flex gap-2 flex-wrap">
          {pendingFiles.map((file, i) => (
            <div key={i} className="relative group">
              {file.type.startsWith('image/') ? (
                <img src={URL.createObjectURL(file)} alt={file.name} className="h-20 rounded border object-cover" />
              ) : (
                <div className="h-20 w-32 rounded border flex flex-col items-center justify-center gap-1 bg-muted px-2">
                  <FileIcon className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground truncate w-full text-center">{file.name}</span>
                </div>
              )}
              <button
                onClick={() => removePendingFile(i)}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Reply preview bar */}
      {replyingTo && (
        <div className="px-4 pt-2 flex items-center gap-2 text-sm">
          <div className="flex-1 min-w-0 border-l-2 border-primary pl-2 py-1">
            <div className="text-xs text-muted-foreground">
              Replying to <span className="font-semibold text-foreground">{replyingTo.sender}</span>
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {replyingTo.messageContent
                ? replyingTo.messageContent.length > 100
                  ? replyingTo.messageContent.slice(0, 100) + '...'
                  : replyingTo.messageContent
                : 'Attachment'}
            </div>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Reconnecting indicator */}
      {reconnecting && (
        <div className="px-4 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
          <div className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
          Reconnecting…
        </div>
      )}

      {/* Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <MessageInput
        value={input}
        onChange={setInput}
        onSend={sendMessage}
        placeholder={reconnecting ? 'Reconnecting…' : `Message #${channelName}`}
        canSend={canSend}
        onPaste={(files) => setPendingFiles((prev) => [...prev, ...files])}
        onAttachClick={() => fileInputRef.current?.click()}
        inputRef={textareaRef}
      />
    </div>
  );
}
