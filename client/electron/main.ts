import { app, BrowserWindow, session, protocol, net, desktopCapturer } from 'electron';
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

  // Allow getDisplayMedia() in the renderer by providing a screen source
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    // Provide the first screen source (entire screen) by default
    if (sources.length > 0) {
      callback({ video: sources[0], audio: 'loopback' });
    } else {
      callback({});
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
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
