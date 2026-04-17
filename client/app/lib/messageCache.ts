import type { OgData } from "~/lib/preload-media";

export type CachedMessage = {
  __id?: string;
  [key: string]: any;
};

export type ChannelCacheEntry = {
  messages: CachedMessage[];
  hasMore: boolean;
  ogCache: Map<string, OgData>;
  replyCache: Map<string, CachedMessage | 'deleted'>;
  lastSeenMessageId: string | null;
  scrollTop: number;
  sharedKey?: CryptoKey;
};

export const channelKey = (channelId: string) => `ch:${channelId}`;
export const dmKey = (partner: string) => `dm:${partner}`;

export class MessageCacheStore {
  private cache = new Map<string, ChannelCacheEntry>();
  constructor(private max = 10) {}

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get(key: string): ChannelCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // Re-insert to mark recently used
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  peek(key: string): ChannelCacheEntry | undefined {
    return this.cache.get(key);
  }

  set(key: string, entry: ChannelCacheEntry, protectedKey?: string): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.evict(protectedKey);
  }

  touch(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  forEach(cb: (key: string, entry: ChannelCacheEntry) => void): void {
    for (const [k, v] of this.cache) cb(k, v);
  }

  appendMessage(key: string, msg: CachedMessage, protectedKey?: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    if (msg.__id && entry.messages.some((m) => m.__id === msg.__id)) return;
    const next: ChannelCacheEntry = { ...entry, messages: [...entry.messages, msg] };
    this.cache.delete(key);
    this.cache.set(key, next);
    this.evict(protectedKey);
  }

  appendMany(key: string, msgs: CachedMessage[], protectedKey?: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    const existing = new Set(entry.messages.map((m) => m.__id).filter(Boolean) as string[]);
    const deduped = msgs.filter((m) => !m.__id || !existing.has(m.__id));
    if (deduped.length === 0) return;
    const next: ChannelCacheEntry = { ...entry, messages: [...entry.messages, ...deduped] };
    this.cache.delete(key);
    this.cache.set(key, next);
    this.evict(protectedKey);
  }

  removeMessageEverywhere(messageId: string): void {
    for (const [k, entry] of this.cache) {
      if (entry.messages.some((m) => m.__id === messageId)) {
        this.cache.set(k, { ...entry, messages: entry.messages.filter((m) => m.__id !== messageId) });
      }
    }
  }

  prependPage(
    key: string,
    msgs: CachedMessage[],
    newHasMore: boolean,
    ogEntries: Map<string, OgData>,
  ): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    const merged = new Map(entry.ogCache);
    ogEntries.forEach((v, k) => merged.set(k, v));
    const next: ChannelCacheEntry = {
      ...entry,
      messages: [...msgs, ...entry.messages],
      hasMore: newHasMore,
      ogCache: merged,
    };
    this.cache.delete(key);
    this.cache.set(key, next);
  }

  updateReplyCache(key: string, id: string, value: CachedMessage | 'deleted'): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    const nextReply = new Map(entry.replyCache);
    nextReply.set(id, value);
    this.cache.set(key, { ...entry, replyCache: nextReply });
  }

  updateLastSeen(key: string, messageId: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    if (entry.lastSeenMessageId === messageId) return;
    this.cache.set(key, { ...entry, lastSeenMessageId: messageId });
  }

  updateScrollTop(key: string, scrollTop: number): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.set(key, { ...entry, scrollTop });
  }

  private evict(protectedKey?: string): void {
    while (this.cache.size > this.max) {
      let victim: string | undefined;
      for (const k of this.cache.keys()) {
        if (k !== protectedKey) { victim = k; break; }
      }
      if (!victim) return;
      this.cache.delete(victim);
    }
  }
}
