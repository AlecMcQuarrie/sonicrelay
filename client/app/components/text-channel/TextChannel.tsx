import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

type Message = {
  channelId: string;
  messageContent: string;
  sender: string;
  timestamp: string;
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
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch messages for this channel
  useEffect(() => {
    setMessages([]);
    const protocol = serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
    fetch(`${protocol}://${serverIP}/channels/${channelId}/messages`, {
      headers: { "access-token": accessToken },
    })
      .then((res) => res.json())
      .then((data) => setMessages(data.messages));
  }, [channelId, accessToken]);

  // Listen for incoming websocket messages for this channel
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.type !== 'text-message') return;
      if (message.channelId === channelId) {
        setMessages((prev) => [...prev, message]);
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [channelId, wsRef]);

  const sendMessage = useCallback(() => {
    if (!input.trim() || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({ type: 'text-message', channelId, messageContent: input }));

    // Add our own message locally (server doesn't echo back to sender)
    setMessages((prev) => [
      ...prev,
      {
        channelId,
        messageContent: input,
        sender: username,
        timestamp: new Date().toISOString(),
      },
    ]);
    setInput("");
  }, [input, username, channelId, wsRef]);

  return (
    <div className="flex flex-col h-screen flex-1">
      {/* Channel header */}
      <div className="p-4 border-b font-bold">
        # {channelName}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg, i) => (
          <div key={i}>
            <span className="font-bold">{msg.sender}</span>{" "}
            <span className="text-xs text-muted-foreground">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
            <p>{msg.messageContent}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 flex gap-2">
        <Input
          placeholder={`Message #${channelName}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <Button onClick={sendMessage} disabled={!input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
