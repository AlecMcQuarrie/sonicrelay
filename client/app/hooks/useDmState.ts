import { useCallback, useState } from "react";

type DmConversation = { partner: string; lastTimestamp: string };

export default function useDmState(username: string, privateKey: CryptoKey | null) {
  const [selectedDmPartner, setSelectedDmPartner] = useState<string | null>(null);
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [publicKeys, setPublicKeys] = useState<Record<string, string>>({});

  const startDm = useCallback((partner: string) => {
    if (partner === username) return;
    if (!privateKey) return;
    setSelectedDmPartner(partner);
    setDmConversations((prev) => {
      if (prev.some((c) => c.partner === partner)) return prev;
      return [{ partner, lastTimestamp: new Date().toISOString() }, ...prev];
    });
  }, [username, privateKey]);

  const handleIncomingDm = useCallback((msg: { sender: string; recipient: string; timestamp: string }) => {
    const partner = msg.sender === username ? msg.recipient : msg.sender;
    setDmConversations((prev) => {
      const filtered = prev.filter((c) => c.partner !== partner);
      return [{ partner, lastTimestamp: msg.timestamp }, ...filtered];
    });
  }, [username]);

  return {
    selectedDmPartner,
    setSelectedDmPartner,
    dmConversations,
    setDmConversations,
    publicKeys,
    setPublicKeys,
    startDm,
    handleIncomingDm,
  };
}
