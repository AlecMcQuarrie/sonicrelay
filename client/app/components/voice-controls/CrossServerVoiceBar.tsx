import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useConnectionManager } from "~/lib/connectionManager";

/*
 * Compact voice bar shown at the top of the layout whenever the user is
 * connected to voice on a server OTHER than the one they're currently viewing.
 * Lets them mute/deafen/leave without switching back, and jump to the voice
 * server with one click.
 */
export default function CrossServerVoiceBar() {
  const {
    activeVoiceServerId,
    activeServerId,
    voiceStatusByServer,
    connections,
    getVoiceActions,
    setActive,
  } = useConnectionManager();

  if (!activeVoiceServerId || activeVoiceServerId === activeServerId) return null;

  const status = voiceStatusByServer[activeVoiceServerId];
  if (!status) return null;

  const voiceServer = connections.find((c) => c.serverId === activeVoiceServerId);
  if (!voiceServer) return null;

  const actions = getVoiceActions(activeVoiceServerId);
  if (!actions) return null;

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background/80">
      <button
        onClick={() => setActive(activeVoiceServerId)}
        className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground truncate"
      >
        Connected to <span className="font-bold text-foreground">#{status.channelName}</span>{" "}
        on <span className="font-bold text-foreground">{voiceServer.serverName}</span>
      </button>
      <Button variant="ghost" size="sm" onClick={actions.toggleMute}>
        {status.isMuted ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4" />}
      </Button>
      <Button variant="ghost" size="sm" onClick={actions.toggleDeafen}>
        {status.isDeafened ? (
          <HeadphoneOff className="w-4 h-4 text-red-500" />
        ) : (
          <Headphones className="w-4 h-4" />
        )}
      </Button>
      <Button variant="ghost" size="sm" onClick={actions.leave}>
        <PhoneOff className="w-4 h-4" />
      </Button>
    </div>
  );
}
