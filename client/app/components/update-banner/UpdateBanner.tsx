import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";

type UpdateState =
  | { status: "checking" }
  | { status: "available"; version: string; releaseUrl: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; filePath: string }
  | { status: "error"; message: string }
  | null;

export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let cleanup: (() => void) | undefined;

    api.checkForUpdate().then((info) => {
      if (info) {
        setUpdate({ status: "available", version: info.version, releaseUrl: info.releaseUrl });
      }
    });

    cleanup = api.onDownloadProgress((percent) => {
      setUpdate((prev) => {
        if (prev?.status === "downloading" || prev?.status === "available") {
          return { status: "downloading", percent };
        }
        return prev;
      });
    });

    return () => { cleanup?.(); };
  }, []);

  if (!update || dismissed) return null;

  const handleDownload = async () => {
    setUpdate({ status: "downloading", percent: 0 });
    const result = await window.electronAPI!.downloadUpdate();
    if (result.success && result.filePath) {
      setUpdate({ status: "ready", filePath: result.filePath });
    } else {
      setUpdate({ status: "error", message: result.error || "Download failed" });
    }
  };

  const handleInstall = () => {
    if (update.status === "ready") {
      window.electronAPI!.installUpdate(update.filePath);
    }
  };

  const handleViewRelease = () => {
    if (update.status === "available") {
      window.electronAPI!.openReleasePage(update.releaseUrl);
    }
  };

  return (
    <div className="flex items-center gap-3 bg-primary/10 border-b border-primary/20 px-4 py-2 text-sm">
      {update.status === "available" && (
        <>
          <RefreshCw className="h-4 w-4 text-primary shrink-0" />
          <span>
            <strong>v{update.version}</strong> is available
          </span>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
          <button
            onClick={handleViewRelease}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Release notes
          </button>
          <button onClick={() => setDismissed(true)} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </>
      )}

      {update.status === "downloading" && (
        <>
          <RefreshCw className="h-4 w-4 text-primary shrink-0 animate-spin" />
          <span>Downloading update...</span>
          <div className="flex-1 max-w-48 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${update.percent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{update.percent}%</span>
        </>
      )}

      {update.status === "ready" && (
        <>
          <Download className="h-4 w-4 text-green-500 shrink-0" />
          <span>Update downloaded</span>
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 rounded-md bg-green-600 text-white px-3 py-1 text-xs font-medium hover:bg-green-500 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Install & Restart
          </button>
        </>
      )}

      {update.status === "error" && (
        <>
          <span className="text-destructive">Update failed: {update.message}</span>
          <button onClick={() => setDismissed(true)} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
