import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Paperclip, X, FileIcon, Trash2 } from "lucide-react";
import MessageAttachments from "./MessageAttachments";

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
}

export default function TextChannel({ serverIP, channelId, channelName, accessToken, username, wsRef }: TextChannelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';

  const isInitialLoad = useRef(true);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: isInitialLoad.current ? "instant" : "smooth" });
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch messages for this channel
  useEffect(() => {
    setMessages([]);
    isInitialLoad.current = true;
    fetch(`${protocol}://${serverIP}/channels/${channelId}/messages`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => {
        setMessages(data.messages);
        // Allow a frame for render, then mark initial load done
        requestAnimationFrame(() => { isInitialLoad.current = false; });
      });
  }, [channelId, accessToken]);

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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2">
        {messages.map((msg, i) => (
          <div key={msg.__id || i} className="min-w-0 group flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <span className="font-bold">{msg.sender}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
              {msg.messageContent && <p className="whitespace-pre-wrap break-words">{msg.messageContent}</p>}
              {msg.attachments && msg.attachments.length > 0 && (
                <MessageAttachments attachments={msg.attachments} serverIP={serverIP} onLoad={scrollToBottom} />
              )}
            </div>
            {msg.sender === username && msg.__id && (
              <button
                onClick={() => deleteMessage(msg.__id!)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
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

      {/* Input */}
      <div className="p-4 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="w-5 h-5" />
        </Button>
        <textarea
          placeholder={`Message #${channelName}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !uploading) {
              e.preventDefault();
              sendMessage();
            }
          }}
          rows={1}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button onClick={sendMessage} disabled={(!input.trim() && pendingFiles.length === 0) || uploading}>
          {uploading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
