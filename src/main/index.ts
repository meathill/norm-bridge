import { app, BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import { ProjectFs } from '@main/services/project-fs';
import { SqliteService } from '@main/services/sqlite-service';
import { ProjectSession } from '@main/services/project-session';
import { registerAllIpcHandlers } from '@main/ipc/register-all';

const moduleDir = import.meta.dirname;

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

const projectFs = new ProjectFs();
const sqliteService = new SqliteService();
const projectSession = new ProjectSession(projectFs, sqliteService);

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    title: 'NormBridge',
    webPreferences: {
      preload: resolve(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(resolve(moduleDir, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  registerAllIpcHandlers({ session: projectSession });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (sqliteService.isOpen()) {
    sqliteService.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (sqliteService.isOpen()) {
    sqliteService.close();
  }
});
