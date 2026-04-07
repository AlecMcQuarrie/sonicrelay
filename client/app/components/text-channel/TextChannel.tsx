import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Paperclip, X, FileIcon, Trash2, SendHorizontal, ArrowDown } from "lucide-react";
import MessageAttachments from "./MessageAttachments";
import MessageContent from "./MessageContent";
import MessageSkeletons from "./MessageSkeletons";
import Avatar from "~/components/ui/avatar";

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

function getExt(url: string): string {
  return url.substring(url.lastIndexOf('.')).toLowerCase();
}

export type OgData = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
};

/** Preload an image URL. Resolves when loaded or errored. */
function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Preload all attachment images + link preview OG data (and their images). */
async function preloadAllMedia(
  messages: Message[],
  protocol: string,
  serverIP: string,
  accessToken: string,
): Promise<Map<string, OgData>> {
  const ogCache = new Map<string, OgData>();
  const imagePromises: Promise<void>[] = [];

  // Collect attachment image URLs
  for (const msg of messages) {
    for (const att of msg.attachments || []) {
      if (IMAGE_EXTS.includes(getExt(att))) {
        imagePromises.push(preloadImage(`${protocol}://${serverIP}${att}`));
      }
    }
  }

  // Collect all unique URLs from message text for link previews
  const allUrls = new Set<string>();
  for (const msg of messages) {
    if (!msg.messageContent) continue;
    const matches = msg.messageContent.match(URL_REGEX);
    if (matches) matches.forEach((u) => allUrls.add(u));
  }

  // Fetch OG data for all URLs in parallel
  const ogPromises = [...allUrls].map(async (url) => {
    try {
      const res = await fetch(
        `${protocol}://${serverIP}/link-preview?url=${encodeURIComponent(url)}`,
        { headers: { "access-token": accessToken } },
      );
      if (!res.ok) return;
      const data: OgData = await res.json();
      if (data.title || data.image) {
        ogCache.set(url, data);
        // Preload the OG image too
        if (data.image) {
          imagePromises.push(preloadImage(data.image));
        }
        // Preload YouTube thumbnail if applicable
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          imagePromises.push(preloadImage(`https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`));
        }
      }
    } catch { /* skip failed previews */ }
  });

  // Wait for all OG fetches first (they may add images to preload)
  await Promise.all(ogPromises);
  // Then wait for all images (attachments + OG images)
  await Promise.all(imagePromises);

  return ogCache;
}

type Message = {
  __id?: string;
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
  attachments?: string[];
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
}

export default function TextChannel({ serverIP, channelId, channelName, accessToken, username, wsRef, profilePhotos, myRole }: TextChannelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [ogCache, setOgCache] = useState<Map<string, OgData>>(new Map());

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  // Fetch initial messages, preload all media (attachments + link previews), then reveal
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setInitialLoading(true);
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
    if (loadingMore || !hasMore || messages.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    setLoadingMore(true);
    const oldest = messages[0];
    const res = await fetch(
      `${protocol}://${serverIP}/channels/${channelId}/messages?limit=50&before=${oldest.__id}`,
      { headers: { "access-token": accessToken } }
    );
    const data = await res.json();

    // Preload all media in the older page before inserting
    const newOgEntries = await preloadAllMedia(data.messages, protocol, serverIP, accessToken);

    // Snapshot scroll state, flush all updates synchronously, then restore
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

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

    // DOM is now updated — restore scroll position immediately
    const addedHeight = container.scrollHeight - prevScrollHeight;
    container.scrollTop = prevScrollTop - addedHeight;
  }, [loadingMore, hasMore, messages, channelId, accessToken, serverIP, protocol]);

  // IntersectionObserver to detect scrolling to the top (oldest messages)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadOlder(); },
      { root: scrollContainerRef.current, threshold: 0 }
    );
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
    }));

    setInput("");
    setPendingFiles([]);
  }, [input, pendingFiles, username, channelId, wsRef]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="p-4 border-b font-bold">
        # {channelName}
      </div>

      {/* Messages — column-reverse keeps viewport anchored to bottom */}
      {initialLoading ? (
        <div className="flex-1 overflow-hidden">
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
            return (
            <div key={msg.__id || i} className="min-w-0 group flex gap-2 items-start">
              <Avatar username={msg.sender} profilePhoto={photoUrl} className="mt-0.5" />
              <div className="flex-1 min-w-0">
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
              {(msg.sender === username || myRole !== 'member') && msg.__id && (
                <button
                  onClick={() => deleteMessage(msg.__id!)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-1 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            );
          })}
        </div>

        {/* Jump to bottom button */}
        {showJumpToBottom && (
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

      {/* Input */}
      <div className="p-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex items-center gap-1 rounded-md border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            placeholder={`Message #${channelName}`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = textareaRef.current;
              if (el) {
                el.style.height = "auto";
                const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
                el.style.height = Math.min(el.scrollHeight, lineHeight * 6) + "px";
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                setPendingFiles((prev) => [...prev, ...files]);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !uploading) {
                e.preventDefault();
                sendMessage();
                if (textareaRef.current) textareaRef.current.style.height = "auto";
              }
            }}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <button
            onClick={() => { sendMessage(); if (textareaRef.current) textareaRef.current.style.height = "auto"; }}
            disabled={(!input.trim() && pendingFiles.length === 0) || uploading}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-50 disabled:pointer-events-none"
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
