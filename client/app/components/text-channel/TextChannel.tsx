import { useCallback, useEffect, useRef, useState } from "react";
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
import type { OgData } from "~/lib/preload-media";

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
  username: string;
  wsRef: React.RefObject<WebSocket | null>;
  profilePhotos: Record<string, string | null>;
  myRole: 'superadmin' | 'admin' | 'member';
  onStartDm?: (username: string) => void;
}

export default function TextChannel({ serverIP, channelId, channelName, accessToken, username, wsRef, profilePhotos, myRole, onStartDm }: TextChannelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [ogCache, setOgCache] = useState<Map<string, OgData>>(new Map());
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [replyCache, setReplyCache] = useState<Map<string, Message | 'deleted'>>(new Map());
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [jumpingToMessage, setJumpingToMessage] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  // Fetch initial messages, preload all media (attachments + link previews), then reveal
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setInitialLoading(true);
    setReplyingTo(null);
    setReplyCache(new Map());
    fetch(`${protocol}://${serverIP}/channels/${channelId}/messages?limit=50`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then(async (data) => {
        const cache = await preloadAllMedia(data.messages, protocol, serverIP, accessToken);
        setOgCache(cache);
        setMessages(data.messages);
        setHasMore(data.hasMore);
        setInitialLoading(false);
      });
  }, [channelId, accessToken]);

  // Load older messages — preload all media, then reveal
  const loadOlder = useCallback(async () => {
    // Use ref guard to prevent cascading — state updates are async and the observer can fire again
    if (loadingRef.current || !hasMore || messages.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    loadingRef.current = true;
    setLoadingMore(true);

    // Disconnect observer while we're loading to prevent cascade
    observerRef.current?.disconnect();

    const oldest = messages[0];
    const res = await fetch(
      `${protocol}://${serverIP}/channels/${channelId}/messages?limit=50&before=${oldest.__id}`,
      { headers: { "access-token": accessToken } }
    );
    const data = await res.json();

    // Preload all media in the older page before inserting
    const newOgEntries = await preloadAllMedia(data.messages, protocol, serverIP, accessToken);

    // Find the DOM element of the first currently-visible message to anchor to
    const firstMsgId = messages[0].__id;
    const anchorEl = firstMsgId
      ? container.querySelector(`[data-msg-id="${firstMsgId}"]`) as HTMLElement | null
      : null;
    const anchorOffsetBefore = anchorEl ? anchorEl.getBoundingClientRect().top : null;

    flushSync(() => {
      setOgCache((prev) => {
        const merged = new Map(prev);
        newOgEntries.forEach((v, k) => merged.set(k, v));
        return merged;
      });
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      setLoadingMore(false);
    });

    // DOM is updated — scroll so the anchor element stays in the same visual position
    if (anchorEl && anchorOffsetBefore !== null) {
      const anchorOffsetAfter = anchorEl.getBoundingClientRect().top;
      const drift = anchorOffsetAfter - anchorOffsetBefore;
      container.scrollTop += drift;
    }

    // Re-enable observer after a short delay so it doesn't immediately fire
    loadingRef.current = false;
    requestAnimationFrame(() => {
      const sentinel = sentinelRef.current;
      if (sentinel && observerRef.current) {
        observerRef.current.observe(sentinel);
      }
    });
  }, [hasMore, messages, channelId, accessToken, serverIP, protocol]);

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

  // Track scroll position to show/hide "jump to bottom" button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      // In a column-reverse container, scrollTop is 0 at the bottom and negative as you scroll up
      setShowJumpToBottom(container.scrollTop < -100);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const jumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Listen for incoming websocket messages for this channel
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type === 'text-message' && message.channelId === channelId) {
        setMessages((prev) => [...prev, message]);
      }
      if (message.type === 'delete-message') {
        setMessages((prev) => prev.filter((m) => m.__id !== message.messageId));
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [channelId, wsRef]);

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
    if (!wsRef.current) return;

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
          setReplyCache((prev) => new Map(prev).set(id, 'deleted'));
        } else if (res.ok) {
          return res.json().then((data: Message) => {
            setReplyCache((prev) => new Map(prev).set(id, data));
          });
        }
      }).catch(() => {});
    }
  }, [messages, replyCache, protocol, serverIP, accessToken]);

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

    // Check if already in DOM
    const existing = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null;
    if (existing) {
      existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightMessage(targetId);
      return;
    }

    // Need to paginate backwards — scroll progressively with each page
    setJumpingToMessage(true);
    loadingRef.current = true;
    observerRef.current?.disconnect();

    // Immediately scroll to the top so the user sees motion right away
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

      const newOgEntries = await preloadAllMedia(data.messages, protocol, serverIP, accessToken);

      flushSync(() => {
        setOgCache((prev) => {
          const merged = new Map(prev);
          newOgEntries.forEach((v, k) => merged.set(k, v));
          return merged;
        });
        setMessages((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore);
      });

      currentMessages = [...data.messages, ...currentMessages];
      moreAvailable = data.hasMore;

      if (data.messages.some((m: Message) => m.__id === targetId)) {
        found = true;
      }

      // Scroll up progressively after each page loads
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (!found) {
            // Intermediate page — scroll to the top of loaded messages
            container.scrollTo({ top: container.scrollHeight * -1, behavior: 'smooth' });
          }
          resolve();
        });
      });
    }

    setJumpingToMessage(false);

    // Final scroll — use double-rAF to ensure DOM is fully laid out, then manually
    // compute scroll position to avoid scrollIntoView quirks with column-reverse
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

    // Re-enable observer
    loadingRef.current = false;
    requestAnimationFrame(() => {
      const sentinel = sentinelRef.current;
      if (sentinel && observerRef.current) {
        observerRef.current.observe(sentinel);
      }
    });
  }, [messages, hasMore, channelId, accessToken, serverIP, protocol, highlightMessage]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Channel header */}
      <MessageHeader># {channelName}</MessageHeader>

      {/* Messages — column-reverse keeps viewport anchored to bottom */}
      {initialLoading ? (
        <div className="flex-1 overflow-hidden flex flex-col justify-end">
          <MessageSkeletons />
        </div>
      ) : (
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col-reverse">
        <div className="space-y-2">
          {/* Sentinel for loading older messages */}
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {loadingMore && (
            <div className="text-center text-sm text-muted-foreground py-2">Loading older messages...</div>
          )}
          {messages.map((msg, i) => {
            const photo = profilePhotos[msg.sender];
            const photoUrl = photo ? `${protocol}://${serverIP}${photo}` : null;

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
                          "flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5",
                          replyTarget && replyTarget !== 'deleted'
                            ? "cursor-pointer hover:text-foreground transition-colors"
                            : "cursor-default"
                        )}
                      >
                        <CornerUpLeft className="w-3 h-3 shrink-0" />
                        {replyTarget === 'deleted' ? (
                          <span className="italic">Original message was deleted</span>
                        ) : replyTarget ? (
                          <>
                            <span className="font-semibold">{replyTarget.sender}</span>
                            <span className="truncate max-w-60">
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
                    <span className="font-bold">{msg.sender}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    {msg.messageContent && (
                      <MessageContent
                        text={msg.messageContent}
                        serverIP={serverIP}
                        accessToken={accessToken}
                        ogCache={ogCache}
                      />
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <MessageAttachments attachments={msg.attachments} serverIP={serverIP} />
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
        placeholder={`Message #${channelName}`}
        canSend={(!!input.trim() || pendingFiles.length > 0) && !uploading}
        onPaste={(files) => setPendingFiles((prev) => [...prev, ...files])}
        onAttachClick={() => fileInputRef.current?.click()}
        inputRef={textareaRef}
      />
    </div>
  );
}
