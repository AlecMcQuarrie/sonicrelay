import { Button } from "~/components/ui/button";
import Avatar from "~/components/ui/avatar";
import { getProtocol } from "~/lib/protocol";

interface DmConversationListProps {
  conversations: { partner: string; lastTimestamp: string }[];
  selectedPartner: string | null;
  onSelectDm: (partner: string) => void;
  profilePhotos: Record<string, string | null>;
  serverIP: string;
}

export default function DmConversationList({
  conversations,
  selectedPartner,
  onSelectDm,
  profilePhotos,
  serverIP,
}: DmConversationListProps) {
  const protocol = getProtocol(serverIP);

  return (
    <>
      <div className="p-4 pb-1 font-bold text-xs uppercase tracking-wide text-muted-foreground">
        Direct Messages
      </div>
      <div className="px-2 pb-1 space-y-1">
        {conversations.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No conversations yet</div>
        ) : (
          conversations.map((conv) => {
            const photo = profilePhotos[conv.partner];
            const photoUrl = photo ? `${protocol}://${serverIP}${photo}` : null;
            return (
              <Button
                key={conv.partner}
                variant={conv.partner === selectedPartner ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => onSelectDm(conv.partner)}
              >
                <Avatar username={conv.partner} profilePhoto={photoUrl} size="sm" />
                <span className="ml-1 truncate">{conv.partner}</span>
              </Button>
            );
          })
        )}
      </div>
    </>
  );
}
