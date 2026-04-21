declare const __APP_VERSION__: string;

type RemoteControlInputEvent =
  | { kind: 'mouse-move'; x: number; y: number }
  | { kind: 'mouse-down'; button: 'left' | 'right' | 'middle' }
  | { kind: 'mouse-up'; button: 'left' | 'right' | 'middle' }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'key-down'; code: string }
  | { kind: 'key-up'; code: string };

interface ElectronAPI {
  isElectron: true;
  selectScreenSource: (sourceId: string | null, audio: boolean) => void;
  checkForUpdate: () => Promise<{ version: string; downloadUrl: string; releaseUrl: string } | null>;
  downloadUpdate: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
  installUpdate: (filePath: string) => Promise<void>;
  openReleasePage: (url: string) => Promise<void>;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
  showNotification: (title: string, body: string) => Promise<void>;
  remoteControl: {
    queryCapability: () => Promise<{ libraryLoaded: boolean; accessibilityGranted: boolean; sharing: boolean }>;
    armSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
    disarmSession: () => Promise<{ ok: boolean }>;
    injectInput: (sessionId: string, event: RemoteControlInputEvent) => void;
    openAccessibilitySettings: () => Promise<void>;
    clearSharedDisplay: () => Promise<{ ok: boolean }>;
    onSessionEnded: (callback: () => void) => () => void;
  };
}

interface Window {
  electronAPI?: ElectronAPI;
}
