import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectScreenSource: (sourceId: string | null, audio: boolean) => {
    ipcRenderer.send('select-screen-source', sourceId, audio);
  },
});
