import { useEffect, useState } from "react";
import { Check, ShieldAlert, ExternalLink, RefreshCw } from "lucide-react";
import { Switch } from "~/components/ui/switch";

type Capability = {
  libraryLoaded: boolean;
  accessibilityGranted: boolean;
  sharing: boolean;
};

export default function RemoteControlTab() {
  const api = window.electronAPI;
  const [cap, setCap] = useState<Capability | null>(null);
  const [allowIncoming, setAllowIncoming] = useState(() => localStorage.getItem('rcAllowIncoming') !== 'false');

  const refresh = () => {
    api?.remoteControl.queryCapability().then(setCap).catch(() => setCap(null));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!api) {
    // Shouldn't happen because the parent hides the tab, but guard anyway.
    return (
      <p className="text-xs text-muted-foreground">Remote control is only available in the desktop app.</p>
    );
  }

  const saveAllow = (enabled: boolean) => {
    setAllowIncoming(enabled);
    localStorage.setItem('rcAllowIncoming', String(enabled));
  };

  const ready = cap?.libraryLoaded && cap.accessibilityGranted;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium mb-1">Remote Control</h3>
        <p className="text-xs text-muted-foreground">
          Let people in your voice channel control your mouse and keyboard while you're sharing your screen. Every session requires your explicit approval.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Allow incoming requests</label>
          <Switch checked={allowIncoming} onCheckedChange={saveAllow} />
        </div>
        <p className="text-xs text-muted-foreground">
          When off, requests from others are silently declined without showing a prompt.
        </p>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Capability status</span>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Re-check
          </button>
        </div>

        {cap === null && (
          <p className="text-xs text-muted-foreground">Checking…</p>
        )}

        {cap && (
          <div className="space-y-1.5 text-xs">
            <StatusRow
              ok={cap.libraryLoaded}
              okLabel="Input helper loaded"
              failLabel="Input helper could not be loaded (reinstall the app)"
            />
            <StatusRow
              ok={cap.accessibilityGranted}
              okLabel="Accessibility permission granted"
              failLabel="Accessibility permission required"
            />
            {!cap.accessibilityGranted && (
              <button
                onClick={() => api.remoteControl.openAccessibilitySettings()}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open system settings
              </button>
            )}
            {ready && (
              <p className="pt-1 text-muted-foreground">
                {cap.sharing
                  ? "Ready — you're sharing a screen, so others can request control."
                  : "Ready — share a screen to enable control requests."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusRow({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  if (ok) {
    return (
      <p className="flex items-center gap-1.5 text-green-500">
        <Check className="h-3 w-3" />
        {okLabel}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-destructive">
      <ShieldAlert className="h-3 w-3" />
      {failLabel}
    </p>
  );
}
