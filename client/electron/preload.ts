import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectScreenSource: (sourceId: string | null, audio: boolean) => {
    ipcRenderer.send('select-screen-source', sourceId, audio);
  },
  // Auto-update
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: (filePath: string) => ipcRenderer.invoke('install-update', filePath),
  openReleasePage: (url: string) => ipcRenderer.invoke('open-release-page', url),
  onDownloadProgress: (callback: (percent: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('update-download-progress', handler);
    return () => { ipcRenderer.removeListener('update-download-progress', handler); };
  },
  showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', title, body),
  // Remote control — the main process injects OS input via nut.js, but only
  // while a session is armed. The renderer arms on grant, disarms on end.
  remoteControl: {
    queryCapability: () => ipcRenderer.invoke('rc-query-capability'),
    armSession: (sessionId: string) => ipcRenderer.invoke('rc-arm-session', sessionId),
    disarmSession: () => ipcRenderer.invoke('rc-disarm-session'),
    injectInput: (sessionId: string, event: unknown) => ipcRenderer.send('rc-inject-input', sessionId, event),
    openAccessibilitySettings: () => ipcRenderer.invoke('rc-open-accessibility-settings'),
    clearSharedDisplay: () => ipcRenderer.invoke('rc-clear-shared-display'),
    onSessionEnded: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('rc-session-ended', handler);
      return () => { ipcRenderer.removeListener('rc-session-ended', handler); };
    },
  },
});
