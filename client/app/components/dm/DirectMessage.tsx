import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ShieldCheck, X, FileIcon, Trash2, ArrowDown, Reply, CornerUpLeft } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import MessageHeader from "~/components/ui/message-header";
import MessageInput from "~/components/ui/message-input";
import EncryptedAttachments from "~/components/dm/EncryptedAttachments";
import MessageContent from "~/components/text-channel/MessageContent";
import MessageSkeletons from "~/components/text-channel/MessageSkeletons";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "~/components/ui/context-menu";
import { cn } from "~/lib/utils";
import { importPublicKey, deriveSharedSecret, encrypt, decrypt, encryptFile } from "~/lib/crypto";
import { getProtocol, buildUploadUrl } from "~/lib/protocol";
import { preloadAllMedia } from "~/lib/preload-media";
import type { OgData } from "~/lib/preload-media";

type DecryptedMessage = {
  __id: string;
  sender: string;
  text: string;
  timestamp: string;
  attachments: string[];
  replyToId: string | null;
};

interface DirectMessageProps {
  serverIP: string;
  partner: string;
  accessToken: string;
  uploadToken: string | null;
  username: string;
  wsRef: React.RefObject<WebSocket | null>;
  profilePhotos: Record<string, string | null>;
  privateKey: CryptoKey;
  partnerPublicKey: string;
}

export default function DirectMessage({
  serverIP,
  partner,
  accessToken,
  uploadToken,
  username,
  wsRef,
  profilePhotos,
  privateKey,
  partnerPublicKey,
}: DirectMessageProps) {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [input, setInput] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [ogCache, setOgCache] = useState<Map<string, OgData>>(new Map());
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  const [replyCache, setReplyCache] = useState<Map<string, DecryptedMessage | 'deleted'>>(new Map());
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [jumpingToMessage, setJumpingToMessage] = useState(false);

  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const protocol = getProtocol(serverIP);

  async function decryptMessages(
    encrypted: { __id: string; sender: string; iv: string; ciphertext: string; timestamp: string; attachments?: string[]; replyToId?: string | null }[],
    sharedKey: CryptoKey,
  ): Promise<DecryptedMessage[]> {
    const results: DecryptedMessage[] = [];
    for (const msg of encrypted) {
      try {
        const text = await decrypt(sharedKey, msg.iv, msg.ciphertext);
        results.push({
          __id: msg.__id, sender: msg.sender, text, timestamp: msg.timestamp,
          attachments: msg.attachments || [], replyToId: msg.replyToId ?? null,
        });
      } catch {
        results.push({
          __id: msg.__id, sender: msg.sender, text: "[unable to decrypt]", timestamp: msg.timestamp,
          attachments: msg.attachments || [], replyToId: msg.replyToId ?? null,
        });
      }
    }
    return results;
  }

  // Derive the shared secret and load initial messages
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setInitialLoading(true);
    setReplyingTo(null);
    setReplyCache(new Map());
    sharedKeyRef.current = null;

    async function init() {
      const theirPubKey = await importPublicKey(partnerPublicKey);
      const sharedKey = await deriveSharedSecret(privateKey, theirPubKey);
      sharedKeyRef.current = sharedKey;

      const res = await fetch(`${protocol}://${serverIP}/dm/messages/${partner}?limit=50`, {
        headers: { "access-token": accessToken },
      });
      const data = await res.json();
      const decrypted = await decryptMessages(data.messages, sharedKey);
      const cache = await preloadAllMedia(decrypted.map((m) => ({ text: m.text })), protocol, serverIP, accessToken, uploadToken);
      setOgCache(cache);
      setMessages(decrypted);
      setHasMore(data.hasMore);
      setInitialLoading(false);
    }
    init();
  }, [partner, partnerPublicKey, privateKey, accessToken]);

  // Listen for incoming DMs from this partner
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const handler = async (event: MessageEvent) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'dm-delete-message') {
        setMessages((prev) => prev.filter((m) => m.__id !== msg.messageId));
        return;
      }

      if (msg.type !== "dm-message") return;

      const isFromPartner = msg.sender === partner;
      const isEcho = msg.sender === username && msg.recipient === partner;
      if (!isFromPartner && !isEcho) return;

      const sharedKey = sharedKeyRef.current;
      if (!sharedKey) return;

      try {
        const text = await decrypt(sharedKey, msg.iv, msg.ciphertext);
        setMessages((prev) => {
          if (prev.some((m) => m.__id === msg.__id)) return prev;
          return [...prev, {
            __id: msg.__id, sender: msg.sender, text, timestamp: msg.timestamp,
            attachments: msg.attachments || [], replyToId: msg.replyToId ?? null,
          }];
        });
      } catch {
        // Decryption failed — ignore
      }
    };

    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [partner, username]);

  // Infinite scroll for older messages
  useEffect(() => {
    observerRef.current?.disconnect();
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loadingRef.current) loadOlder(); },
      { root: scrollContainerRef.current, threshold: 0 },
    );
    observer.observe(sentinel);
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [hasMore, messages.length]);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMore || messages.length === 0) return;
    const sharedKey = sharedKeyRef.current;
    if (!sharedKey) return;

    loadingRef.current = true;
    setLoadingMore(true);
    observerRef.current?.disconnect();

    try {
      const oldest = messages[0];
      const res = await fetch(
        `${protocol}://${serverIP}/dm/messages/${partner}?limit=50&before=${oldest.__id}`,
        { headers: { "access-token": accessToken } },
      );
      const data = await res.json();
      const decrypted = await decryptMessages(data.messages, sharedKey);
      const newOgEntries = await preloadAllMedia(decrypted.map((m) => ({ text: m.text })), protocol, serverIP, accessToken, uploadToken);

      setOgCache((prev) => {
        const merged = new Map(prev);
        newOgEntries.forEach((v, k) => merged.set(k, v));
        return merged;
      });
      setMessages((prev) => [...decrypted, ...prev]);
      setHasMore(data.hasMore);
    } catch {
      // Network error — allow retry
    } finally {
      setLoadingMore(false);
      loadingRef.current = false;
      requestAnimationFrame(() => {
        const sentinel = sentinelRef.current;
        if (sentinel && observerRef.current) {
          observerRef.current.observe(sentinel);
        }
      });
    }
  }, [hasMore, messages, partner, accessToken]);

  // Track scroll position for jump-to-bottom button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => setShowJumpToBottom(container.scrollTop < -100);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const jumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Fetch reply targets — decrypt them client-side
  useEffect(() => {
    const sharedKey = sharedKeyRef.current;
    if (!sharedKey) return;

    const missingIds = messages
      .filter((m) => m.replyToId && !messages.some((o) => o.__id === m.replyToId) && !replyCache.has(m.replyToId!))
      .map((m) => m.replyToId!);
    const uniqueIds = [...new Set(missingIds)];
    if (uniqueIds.length === 0) return;

    for (const id of uniqueIds) {
      fetch(`${protocol}://${serverIP}/dm/message/${id}`, {
        headers: { "access-token": accessToken },
      }).then(async (res) => {
        if (res.status === 404) {
          setReplyCache((prev) => new Map(prev).set(id, 'deleted'));
        } else if (res.ok) {
          const data = await res.json();
          try {
            const text = await decrypt(sharedKey, data.iv, data.ciphertext);
            setReplyCache((prev) => new Map(prev).set(id, {
              __id: data.__id, sender: data.sender, text, timestamp: data.timestamp,
              attachments: data.attachments || [], replyToId: data.replyToId ?? null,
            }));
          } catch {
            setReplyCache((prev) => new Map(prev).set(id, 'deleted'));
          }
        }
      }).catch(() => {});
    }
  }, [messages, replyCache, protocol, serverIP, accessToken]);

  const startReply = (msg: DecryptedMessage) => {
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
    const sharedKey = sharedKeyRef.current;
    if (!sharedKey) return;

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
        `${protocol}://${serverIP}/dm/messages/${partner}?limit=50&before=${oldest.__id}`,
        { headers: { "access-token": accessToken } },
      );
      const data = await res.json();
      const decrypted = await decryptMessages(data.messages, sharedKey);
      const newOgEntries = await preloadAllMedia(decrypted.map((m) => ({ text: m.text })), protocol, serverIP, accessToken, uploadToken);

      flushSync(() => {
        setOgCache((prev) => {
          const merged = new Map(prev);
          newOgEntries.forEach((v, k) => merged.set(k, v));
          return merged;
        });
        setMessages((prev) => [...decrypted, ...prev]);
        setHasMore(data.hasMore);
      });

      currentMessages = [...decrypted, ...currentMessages];
      moreAvailable = data.hasMore;

      if (decrypted.some((m) => m.__id === targetId)) {
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
  }, [messages, hasMore, partner, accessToken, serverIP, protocol, highlightMessage]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() && pendingFiles.length === 0) return;
    if (!sharedKeyRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      setUploading(true);

      // Encrypt and upload each file individually
      const attachments: string[] = [];
      for (const file of pendingFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const { iv: fileIv, encrypted } = await encryptFile(sharedKeyRef.current, arrayBuffer);
        const formData = new FormData();
        formData.append('files', new Blob([encrypted]), 'encrypted.enc');
        const res = await fetch(`${protocol}://${serverIP}/upload`, {
          method: 'POST',
          headers: { 'access-token': accessToken },
          body: formData,
        });
        const data = await res.json();
        attachments.push(JSON.stringify({ url: data.urls[0], iv: fileIv, name: file.name }));
      }

      setUploading(false);

      const { iv, ciphertext } = await encrypt(sharedKeyRef.current, input);
      wsRef.current.send(JSON.stringify({
        type: "dm-message",
        recipient: partner,
        iv,
        ciphertext,
        attachments,
        replyToId: replyingTo?.__id || null,
      }));
      setInput("");
      setPendingFiles([]);
      setReplyingTo(null);
    } catch {
      setUploading(false);
    }
  }, [input, pendingFiles, partner, wsRef, replyingTo]);

  const deleteMessage = (messageId: string) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'dm-delete-message', messageId }));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const partnerPhoto = profilePhotos[partner];
  const partnerPhotoUrl = partnerPhoto && uploadToken ? buildUploadUrl(partnerPhoto, serverIP, uploadToken) : null;

  if (initialLoading) {
    return (
      <div className="flex flex-col h-full min-w-0">
        <MessageHeader>
          <Avatar username={partner} profilePhoto={partnerPhotoUrl} size="sm" />
          {partner}
        </MessageHeader>
        <div className="flex-1 overflow-hidden flex flex-col justify-end">
          <MessageSkeletons />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <MessageHeader>
        <Avatar username={partner} profilePhoto={partnerPhotoUrl} size="sm" />
        {partner}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 shrink-0">
          <ShieldCheck className="w-3 h-3" />
          E2E ENCRYPTED
        </span>
      </MessageHeader>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col-reverse">
        <div className="space-y-2">
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {loadingMore && (
            <div className="text-center text-sm text-muted-foreground py-2">Loading older messages...</div>
          )}
          {messages.map((msg, i) => {
            const photo = profilePhotos[msg.sender];
            const photoUrl = photo && uploadToken ? buildUploadUrl(photo, serverIP, uploadToken) : null;

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
                              {replyTarget.text
                                ? replyTarget.text.length > 60
                                  ? replyTarget.text.slice(0, 60) + '...'
                                  : replyTarget.text
                                : 'Click to see attachment'}
                            </span>
                          </>
                        ) : (
                          <span className="italic">Loading...</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-bold truncate min-w-0">{msg.sender}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {msg.text && (
                      <MessageContent
                        text={msg.text}
                        serverIP={serverIP}
                        accessToken={accessToken}
                        ogCache={ogCache}
                      />
                    )}
                    {msg.attachments.length > 0 && sharedKeyRef.current && (
                      <EncryptedAttachments attachments={msg.attachments} sharedKey={sharedKeyRef.current} serverIP={serverIP} accessToken={accessToken} />
                    )}
                  </div>
                  <div className="flex gap-0.5 shrink-0 mt-1">
                    <button
                      onClick={() => startReply(msg)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Reply className="w-4 h-4" />
                    </button>
                    {msg.sender === username && (
                      <button
                        onClick={() => deleteMessage(msg.__id)}
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
                {msg.sender === username && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => deleteMessage(msg.__id)} className="cursor-pointer text-destructive focus:text-destructive">
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
              {replyingTo.text
                ? replyingTo.text.length > 100
                  ? replyingTo.text.slice(0, 100) + '...'
                  : replyingTo.text
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
        placeholder={`Message ${partner}`}
        canSend={(!!input.trim() || pendingFiles.length > 0) && !uploading}
        onPaste={(files) => setPendingFiles((prev) => [...prev, ...files])}
        onAttachClick={() => fileInputRef.current?.click()}
        inputRef={textareaRef}
      />
    </div>
  );
}
