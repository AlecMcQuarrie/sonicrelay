declare const __APP_VERSION__: string;

interface ElectronAPI {
  isElectron: true;
  selectScreenSource: (sourceId: string | null, audio: boolean) => void;
  checkForUpdate: () => Promise<{ version: string; downloadUrl: string; releaseUrl: string } | null>;
  downloadUpdate: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
  installUpdate: (filePath: string) => Promise<void>;
  openReleasePage: (url: string) => Promise<void>;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
