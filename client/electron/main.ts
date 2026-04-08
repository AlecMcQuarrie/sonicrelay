import { app, BrowserWindow, session, protocol, net, desktopCapturer, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

// Register scheme as privileged before app ready (must be synchronous, before any async)
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    allowServiceWorkers: true,
    stream: true,
  },
}]);

app.setAppUserModelId('com.sonicrelay.client');

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

app.on('ready', () => {
  if (!isDev) {
    const buildDir = path.join(__dirname, '..', 'build', 'client');

    // Register on the default session, not the global protocol
    session.defaultSession.protocol.handle('app', (request) => {
      const url = new URL(request.url);
      let filePath = path.join(buildDir, decodeURIComponent(url.pathname));

      // SPA fallback: serve index.html for any path that isn't a real file
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(buildDir, 'index.html');
      }

      return net.fetch(pathToFileURL(filePath).toString());
    });
  }

  // Allow getDisplayMedia() in the renderer — show a source picker window
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });

    if (sources.length === 0) {
      callback({});
      return;
    }

    const picker = new BrowserWindow({
      width: 680,
      height: 500,
      parent: mainWindow!,
      modal: true,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Build source data with thumbnail data URLs
    const sourceData = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));

    const pickerHTML = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Geist Variable', 'Inter', system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fafafa; padding: 20px; user-select: none; }
  h2 { font-size: 15px; font-weight: 500; margin-bottom: 14px; color: #fafafa; }
  .sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; max-height: 340px; overflow-y: auto; padding-right: 4px; }
  .sources::-webkit-scrollbar { width: 6px; }
  .sources::-webkit-scrollbar-track { background: transparent; }
  .sources::-webkit-scrollbar-thumb { background: #262626; border-radius: 3px; }
  .source { border: 2px solid transparent; border-radius: 10px; padding: 8px; cursor: pointer; background: #171717; transition: border-color 0.15s, background 0.15s; }
  .source:hover { background: #262626; }
  .source.selected { border-color: #fafafa; background: #262626; }
  .source img { width: 100%; border-radius: 6px; display: block; }
  .source .name { font-size: 12px; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #a1a1a1; }
  .source.selected .name { color: #fafafa; }
  .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
  .audio-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #a1a1a1; }
  .audio-toggle input { accent-color: #fafafa; }
  .buttons { display: flex; gap: 8px; }
  button { padding: 8px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s; }
  .btn-cancel { background: #262626; color: #a1a1a1; }
  .btn-cancel:hover { background: #333; }
  .btn-share { background: #fafafa; color: #0a0a0a; }
  .btn-share:hover { background: #e0e0e0; }
  .btn-share:disabled { opacity: 0.3; cursor: default; }
</style></head><body>
  <h2>Choose what to share</h2>
  <div class="sources" id="sources"></div>
  <div class="footer">
    <label class="audio-toggle"><input type="checkbox" id="audio" checked> Share audio</label>
    <div class="buttons">
      <button class="btn-cancel" id="cancel">Cancel</button>
      <button class="btn-share" id="share" disabled>Share</button>
    </div>
  </div>
  <script>
    const sources = ${JSON.stringify(sourceData)};
    const container = document.getElementById('sources');
    let selectedId = null;
    sources.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'source';
      div.innerHTML = '<img src="' + s.thumbnail + '"><div class="name">' + s.name.replace(/</g, '&lt;') + '</div>';
      div.onclick = () => {
        document.querySelectorAll('.source').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedId = s.id;
        document.getElementById('share').disabled = false;
      };
      container.appendChild(div);
    });
    document.getElementById('cancel').onclick = () => {
      window.electronAPI.selectScreenSource(null, false);
    };
    document.getElementById('share').onclick = () => {
      if (selectedId) {
        window.electronAPI.selectScreenSource(selectedId, document.getElementById('audio').checked);
      }
    };
  </script>
</body></html>`;

    picker.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pickerHTML));

    // Wait for the user's selection via IPC
    const selection = await new Promise<{ sourceId: string | null; audio: boolean }>((resolve) => {
      const handler = (_event: Electron.IpcMainEvent, sourceId: string | null, audio: boolean) => {
        resolve({ sourceId, audio });
      };
      ipcMain.once('select-screen-source', handler);
      picker.on('closed', () => {
        ipcMain.removeListener('select-screen-source', handler);
        resolve({ sourceId: null, audio: false });
      });
    });

    if (!picker.isDestroyed()) picker.close();

    if (selection.sourceId) {
      const selected = sources.find((s) => s.id === selection.sourceId);
      if (selected) {
        callback({ video: selected, ...(selection.audio ? { audio: 'loopback' } : {}) });
        return;
      }
    }
    callback({});
  });

  createWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: isDev
      ? path.join(__dirname, '..', 'public', 'SonicRelayLogo.png')
      : path.join(__dirname, '..', 'build', 'client', 'SonicRelayLogo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'SonicRelay',
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadURL('app://-/');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
