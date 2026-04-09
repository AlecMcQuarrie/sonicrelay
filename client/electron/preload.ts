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
});
