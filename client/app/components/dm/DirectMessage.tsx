import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizontal, ShieldCheck } from "lucide-react";
import Avatar from "~/components/ui/avatar";
import { Skeleton } from "~/components/ui/skeleton";
import { importPublicKey, deriveSharedSecret, encrypt, decrypt } from "~/lib/crypto";
import { getProtocol } from "~/lib/protocol";

type DecryptedMessage = {
  __id: string;
  sender: string;
  text: string;
  timestamp: string;
};

interface DirectMessageProps {
  serverIP: string;
  partner: string;
  accessToken: string;
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

  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const protocol = getProtocol(serverIP);

  // Derive the shared secret and load initial messages
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setInitialLoading(true);
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
      if (msg.type !== "dm-message") return;

      // Only handle messages for this conversation
      const isFromPartner = msg.sender === partner;
      const isEcho = msg.sender === username && msg.recipient === partner;
      if (!isFromPartner && !isEcho) return;

      const sharedKey = sharedKeyRef.current;
      if (!sharedKey) return;

      try {
        const text = await decrypt(sharedKey, msg.iv, msg.ciphertext);
        setMessages((prev) => {
          // Avoid duplicates (echo from own send)
          if (prev.some((m) => m.__id === msg.__id)) return prev;
          return [...prev, { __id: msg.__id, sender: msg.sender, text, timestamp: msg.timestamp }];
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
      ([entry]) => { if (entry.isIntersecting) loadOlder(); },
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

      setMessages((prev) => [...decrypted, ...prev]);
      setHasMore(data.hasMore);
    } catch {
      // Network error — allow retry
    } finally {
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, [hasMore, messages, partner, accessToken]);

  async function decryptMessages(
    encrypted: { __id: string; sender: string; iv: string; ciphertext: string; timestamp: string }[],
    sharedKey: CryptoKey,
  ): Promise<DecryptedMessage[]> {
    const results: DecryptedMessage[] = [];
    for (const msg of encrypted) {
      try {
        const text = await decrypt(sharedKey, msg.iv, msg.ciphertext);
        results.push({ __id: msg.__id, sender: msg.sender, text, timestamp: msg.timestamp });
      } catch {
        results.push({ __id: msg.__id, sender: msg.sender, text: "[unable to decrypt]", timestamp: msg.timestamp });
      }
    }
    return results;
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !sharedKeyRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      const { iv, ciphertext } = await encrypt(sharedKeyRef.current, text);
      wsRef.current.send(JSON.stringify({
        type: "dm-message",
        recipient: partner,
        iv,
        ciphertext,
      }));
      setInput("");
    } catch {
      // Encryption or send failed — keep input so user can retry
    }
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const partnerPhoto = profilePhotos[partner];
  const partnerPhotoUrl = partnerPhoto ? `${protocol}://${serverIP}${partnerPhoto}` : null;

  // Loading skeletons
  if (initialLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-4 border-b">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="w-24 h-4" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="space-y-1">
                <Skeleton className="w-20 h-3" />
                <Skeleton className="w-48 h-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <Avatar username={partner} profilePhoto={partnerPhotoUrl} />
        <span className="font-bold">{partner}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full bg-green-500/15 text-green-500 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          E2E ENCRYPTED
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col-reverse">
        <div className="space-y-2">
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {loadingMore && (
            <div className="text-center text-sm text-muted-foreground py-2">Loading older messages...</div>
          )}
          {messages.map((msg) => {
            const photo = profilePhotos[msg.sender];
            const photoUrl = photo ? `${protocol}://${serverIP}${photo}` : null;
            return (
              <div key={msg.__id} className="flex gap-2 items-start">
                <Avatar username={msg.sender} profilePhoto={photoUrl} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold">{msg.sender}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex items-end gap-2 bg-muted rounded-lg px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${partner}`}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm max-h-32"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
