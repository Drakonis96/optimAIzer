const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PREFERRED_SERVER_PORT = Number(process.env.OPTIMAIZER_SERVER_PORT || 0);
const isDev = process.env.ELECTRON_IS_DEV === '1';

let mainWindow = null;
let backendController = null;
let backendPort = 0;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureRuntimePaths() {
  const userDataPath = app.getPath('userData');
  const dataRoot = path.join(userDataPath, 'data');
  const agentsRoot = path.join(dataRoot, 'agents');
  const auditRoot = path.join(dataRoot, 'audit');
  const dbPath = path.join(dataRoot, 'optimaizer.db');
  const envPath = path.join(userDataPath, '.env');

  ensureDir(dataRoot);
  ensureDir(agentsRoot);
  ensureDir(auditRoot);

  if (!fs.existsSync(envPath)) {
    try {
      fs.writeFileSync(envPath, '', 'utf-8');
    } catch {
      // best effort
    }
  }

  process.env.OPTIMAIZER_DB_PATH = process.env.OPTIMAIZER_DB_PATH || dbPath;
  process.env.OPTIMAIZER_AGENTS_DATA_ROOT = process.env.OPTIMAIZER_AGENTS_DATA_ROOT || agentsRoot;
  process.env.OPTIMAIZER_AUDIT_LOG_DIR = process.env.OPTIMAIZER_AUDIT_LOG_DIR || auditRoot;
  process.env.OPTIMAIZER_ENV_PATH = process.env.OPTIMAIZER_ENV_PATH || envPath;
}

function startBackendForDesktop() {
  if (isDev) return Promise.resolve();

  return new Promise(async (resolve, reject) => {
    const serverEntry = path.join(app.getAppPath(), 'server', 'dist', 'index.js');

    if (!fs.existsSync(serverEntry)) {
      reject(new Error(`Server build not found at: ${serverEntry}`));
      return;
    }

    try {
      const serverModule = require(serverEntry);
      const startServer = serverModule.startServer || serverModule.default;
      if (typeof startServer !== 'function') {
        reject(new Error('Invalid backend entry: startServer function not found.'));
        return;
      }

      backendController = startServer({
        port: PREFERRED_SERVER_PORT,
        registerSignalHandlers: false,
      });

      const actualAddress = backendController?.server?.address?.();
      if (actualAddress && typeof actualAddress === 'object' && actualAddress.port) {
        backendPort = actualAddress.port;
      }
    } catch (error) {
      reject(error);
      return;
    }

    const startedAt = Date.now();
    const timeoutMs = 25000;

    const checkReady = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // retry
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Backend did not become ready in time.'));
        return;
      }

      setTimeout(checkReady, 500);
    };

    setTimeout(checkReady, 400);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 740,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const url = isDev
    ? (process.env.ELECTRON_START_URL || 'http://localhost:3000')
    : `http://127.0.0.1:${backendPort}`;

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function stopBackend() {
  if (!backendController || typeof backendController.shutdown !== 'function') return;
  await Promise.resolve(backendController.shutdown()).catch(() => {
    // best effort shutdown
  });
  backendController = null;
}

ipcMain.handle('desktop:reset-local-data', async () => {
  try {
    await stopBackend();

    const userDataPath = app.getPath('userData');
    const dataRoot = process.env.OPTIMAIZER_DATA_ROOT || path.join(userDataPath, 'data');
    const envPath = process.env.OPTIMAIZER_ENV_PATH || path.join(userDataPath, '.env');

    const targets = Array.from(
      new Set(
        [
          process.env.OPTIMAIZER_DB_PATH,
          process.env.OPTIMAIZER_AGENTS_DATA_ROOT,
          process.env.OPTIMAIZER_AUDIT_LOG_DIR,
          dataRoot,
          envPath,
        ]
          .filter((value) => typeof value === 'string' && value.trim().length > 0)
          .map((value) => path.resolve(value))
      )
    );

    for (const target of targets) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }

    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

app.whenReady().then(async () => {
  try {
    ensureRuntimePaths();
    await startBackendForDesktop();
    createMainWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'optimAIzer desktop startup error',
      `${message}\n\nTip: ensure dependencies are installed and run \"npm run build\" before desktop:start.`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
