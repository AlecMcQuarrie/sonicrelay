import { app, BrowserWindow, session, protocol, net, desktopCapturer, ipcMain, shell, Notification, systemPreferences, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { pathToFileURL } from 'url';

// --- Auto-update (DIY via GitHub Releases) ---

const GITHUB_OWNER = 'AlecMcQuarrie';
const GITHUB_REPO = 'sonicrelay';

type UpdateInfo = { version: string; downloadUrl: string; releaseUrl: string };

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

function getAssetPattern(): string {
  switch (process.platform) {
    case 'win32': return '.exe';
    case 'darwin': return '.dmg';
    default: return '.AppImage';
  }
}

function checkForUpdates(): Promise<UpdateInfo | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': `SonicRelay/${app.getVersion()}` },
    };

    https.get(options, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      if (res.statusCode !== 200) { resolve(null); return; }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latest = release.tag_name as string;
          if (!compareVersions(app.getVersion(), latest)) { resolve(null); return; }

          const ext = getAssetPattern();
          const asset = (release.assets as { name: string; browser_download_url: string }[])
            .find((a) => a.name.endsWith(ext));

          resolve({
            version: latest.replace(/^v/, ''),
            downloadUrl: asset?.browser_download_url ?? '',
            releaseUrl: release.html_url as string,
          });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function downloadAsset(url: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (downloadUrl: string) => {
      https.get(downloadUrl, { headers: { 'User-Agent': `SonicRelay/${app.getVersion()}` } }, (res) => {
        // Follow redirects (GitHub sends 302 to the actual file)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) { follow(location); return; }
        }
        if (res.statusCode !== 200) { reject(new Error(`Download failed: ${res.statusCode}`)); return; }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) onProgress(Math.round((receivedBytes / totalBytes) * 100));
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    };
    follow(url);
  });
}

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

// ─── Remote control (screen share input injection) ─────────────────────────
//
// A single input-injection session at a time. The main process owns the
// "armed" state — the renderer can ask to arm/disarm, but injection refuses
// any event that doesn't match the currently-armed sessionId. Lazy-loaded so
// the native module is never required when the feature isn't in use.

type DisplayBounds = { x: number; y: number; width: number; height: number };

type ActiveSession = {
  sessionId: string;
  bounds: DisplayBounds;
  heldKeys: Set<string>;
  windowStart: number;
  eventsInWindow: number;
};

let activeSession: ActiveSession | null = null;
let sharedDisplayBounds: DisplayBounds | null = null;
let nutjs: typeof import('@nut-tree-fork/nut-js') | null = null;

async function loadNutJs() {
  if (nutjs) return nutjs;
  const mod = await import('@nut-tree-fork/nut-js');
  mod.mouse.config.mouseSpeed = 1000;       // near-instant moves; we drive position directly
  mod.mouse.config.autoDelayMs = 0;
  mod.keyboard.config.autoDelayMs = 0;
  nutjs = mod;
  return nutjs;
}

function accessibilityGranted(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

// Pick the bounds of the display the user chose to share. sourceId for a
// screen is `screen:<display_id>:<monitor>`. For windows we approximate by
// finding the display containing the window's current position, falling
// back to the primary display.
function boundsForSource(source: Electron.DesktopCapturerSource): DisplayBounds {
  if (source.id.startsWith('screen:')) {
    const displayId = Number(source.display_id);
    const match = screen.getAllDisplays().find((d) => d.id === displayId);
    if (match) return match.bounds;
  }
  return screen.getPrimaryDisplay().bounds;
}

// Map browser KeyboardEvent.code to nut.js Key. Keep the table close to the
// keys users actually press; unknown codes are dropped silently rather than
// producing surprise output.
function mapKey(code: string, K: typeof import('@nut-tree-fork/nut-js').Key): number | null {
  if (/^Key[A-Z]$/.test(code)) return (K as any)[code.slice(3)] ?? null;
  if (/^Digit[0-9]$/.test(code)) return (K as any)[`Num${code.slice(5)}`] ?? null;
  if (/^F([1-9]|1[0-2])$/.test(code)) return (K as any)[code] ?? null;
  const table: Record<string, number> = {
    Enter: K.Enter, Space: K.Space, Tab: K.Tab, Backspace: K.Backspace,
    Escape: K.Escape, Delete: K.Delete, Insert: K.Insert,
    ArrowUp: K.Up, ArrowDown: K.Down, ArrowLeft: K.Left, ArrowRight: K.Right,
    Home: K.Home, End: K.End, PageUp: K.PageUp, PageDown: K.PageDown,
    ShiftLeft: K.LeftShift, ShiftRight: K.RightShift,
    ControlLeft: K.LeftControl, ControlRight: K.RightControl,
    AltLeft: K.LeftAlt, AltRight: K.RightAlt,
    MetaLeft: K.LeftSuper, MetaRight: K.RightSuper,
    CapsLock: K.CapsLock,
    Minus: K.Minus, Equal: K.Equal,
    BracketLeft: K.LeftBracket, BracketRight: K.RightBracket,
    Backslash: K.Backslash, Semicolon: K.Semicolon, Quote: K.Quote,
    Comma: K.Comma, Period: K.Period, Slash: K.Slash, Backquote: K.Grave,
  };
  return table[code] ?? null;
}

async function disarmSession() {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  // Release any keys that were pressed but never released. Otherwise the
  // sharer's OS thinks Shift/Ctrl is still held down after a session ends.
  if (nutjs && session.heldKeys.size > 0) {
    const K = nutjs.Key;
    for (const code of session.heldKeys) {
      const k = mapKey(code, K);
      if (k !== null) {
        try { await nutjs.keyboard.releaseKey(k); } catch {}
      }
    }
  }
  mainWindow?.webContents.send('rc-session-ended');
}
// --- End remote control state ---

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
        // Record which display was shared so remote-control can map normalized
        // cursor coords from viewers back to this screen's pixel bounds.
        sharedDisplayBounds = boundsForSource(selected);
        callback({ video: selected, ...(selection.audio ? { audio: 'loopback' } : {}) });
        return;
      }
    }
    sharedDisplayBounds = null;
    callback({});
  });

  // --- Update IPC handlers ---

  let pendingUpdate: UpdateInfo | null = null;

  ipcMain.handle('check-for-update', async () => {
    pendingUpdate = await checkForUpdates();
    return pendingUpdate;
  });

  ipcMain.handle('download-update', async (event) => {
    if (!pendingUpdate || !pendingUpdate.downloadUrl) return { success: false, error: 'No update available' };

    const ext = getAssetPattern();
    const fileName = `SonicRelay-${pendingUpdate.version}${ext}`;
    const destPath = path.join(app.getPath('downloads'), fileName);

    try {
      await downloadAsset(pendingUpdate.downloadUrl, destPath, (percent) => {
        mainWindow?.webContents.send('update-download-progress', percent);
      });
      return { success: true, filePath: destPath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('install-update', async (_event, filePath: string) => {
    shell.openPath(filePath);
    app.quit();
  });

  ipcMain.handle('open-release-page', async (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('show-notification', (_event, title: string, body: string) => {
    new Notification({ title, body }).show();
  });

  // --- Remote control IPC ---

  ipcMain.handle('rc-query-capability', async () => {
    let libraryLoaded = !!nutjs;
    if (!libraryLoaded) {
      try { await loadNutJs(); libraryLoaded = true; } catch { libraryLoaded = false; }
    }
    return {
      libraryLoaded,
      accessibilityGranted: accessibilityGranted(),
      sharing: sharedDisplayBounds !== null,
    };
  });

  ipcMain.handle('rc-arm-session', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: 'invalid session id' };
    if (activeSession) return { ok: false, error: 'a session is already armed' };
    if (!sharedDisplayBounds) return { ok: false, error: 'not currently sharing a screen' };
    if (!accessibilityGranted()) return { ok: false, error: 'accessibility permission not granted' };
    try { await loadNutJs(); }
    catch (err: any) { return { ok: false, error: `failed to load input library: ${err?.message ?? err}` }; }
    activeSession = {
      sessionId,
      bounds: sharedDisplayBounds,
      heldKeys: new Set(),
      windowStart: Date.now(),
      eventsInWindow: 0,
    };
    return { ok: true };
  });

  ipcMain.handle('rc-disarm-session', async () => {
    await disarmSession();
    return { ok: true };
  });

  // Called by the renderer when screen sharing ends, so a subsequent
  // arm-session can't latch onto stale display bounds.
  ipcMain.handle('rc-clear-shared-display', async () => {
    sharedDisplayBounds = null;
    await disarmSession();
    return { ok: true };
  });

  ipcMain.handle('rc-open-accessibility-settings', async () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      // Prompt so the app appears in the list immediately — the `true`
      // argument triggers the macOS permission dialog on first call.
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  });

  // Fire-and-forget; the renderer sends many events per second during control.
  ipcMain.on('rc-inject-input', async (_event, sessionId: string, evt: any) => {
    const session = activeSession;
    if (!session || session.sessionId !== sessionId || !nutjs) return;
    if (!evt || typeof evt !== 'object') return;

    // Rolling-window rate limit: 300 events / second. Well above normal
    // mousemove rate (~60Hz) but catches runaway senders.
    const now = Date.now();
    if (now - session.windowStart > 1000) {
      session.windowStart = now;
      session.eventsInWindow = 0;
    }
    if (++session.eventsInWindow > 300) return;

    const { mouse, keyboard, Button, Key, Point } = nutjs;

    try {
      switch (evt.kind) {
        case 'mouse-move': {
          if (typeof evt.x !== 'number' || typeof evt.y !== 'number') return;
          const x = Math.round(session.bounds.x + Math.min(1, Math.max(0, evt.x)) * session.bounds.width);
          const y = Math.round(session.bounds.y + Math.min(1, Math.max(0, evt.y)) * session.bounds.height);
          await mouse.setPosition(new Point(x, y));
          return;
        }
        case 'mouse-down':
        case 'mouse-up': {
          const btn = evt.button === 'right' ? Button.RIGHT
            : evt.button === 'middle' ? Button.MIDDLE
            : Button.LEFT;
          if (evt.kind === 'mouse-down') await mouse.pressButton(btn);
          else await mouse.releaseButton(btn);
          return;
        }
        case 'wheel': {
          const dy = Number(evt.dy) || 0;
          const dx = Number(evt.dx) || 0;
          if (dy < 0) await mouse.scrollUp(Math.min(50, Math.abs(dy)));
          else if (dy > 0) await mouse.scrollDown(Math.min(50, dy));
          if (dx < 0) await mouse.scrollLeft(Math.min(50, Math.abs(dx)));
          else if (dx > 0) await mouse.scrollRight(Math.min(50, dx));
          return;
        }
        case 'key-down':
        case 'key-up': {
          if (typeof evt.code !== 'string') return;
          const k = mapKey(evt.code, Key);
          if (k === null) return;
          if (evt.kind === 'key-down') {
            session.heldKeys.add(evt.code);
            await keyboard.pressKey(k);
          } else {
            session.heldKeys.delete(evt.code);
            await keyboard.releaseKey(k);
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[remote-control] injection error:', err);
    }
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
  // Release any held keys before quitting so the OS isn't left thinking a
  // modifier is still pressed by a process that no longer exists.
  disarmSession().finally(() => app.quit());
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
