import { app, BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import { resolveAgentRunner } from '@agents/index';
import { resolveSearchRunner } from '@agents/search-runner';
import { ProjectFs } from '@main/services/project-fs';
import { SqliteService } from '@main/services/sqlite-service';
import { ProjectSession } from '@main/services/project-session';
import { SourceRegistry } from '@main/services/source-registry';
import { ImportService } from '@main/services/import-service';
import { ArtifactStore } from '@main/services/artifact-store';
import { JobBus } from '@main/services/job-bus';
import { JobService } from '@main/services/job-service';
import { SchemaCompileService } from '@main/services/schema-compile-service';
import { SearchService } from '@main/services/search-service';
import { ParserRegistry } from '@main/parsers/parser-registry';
import { registerAllIpcHandlers } from '@main/ipc/register-all';

const moduleDir = import.meta.dirname;

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

const projectFs = new ProjectFs();
const sqliteService = new SqliteService();
const projectSession = new ProjectSession(projectFs, sqliteService);
const sourceRegistry = new SourceRegistry(projectFs, sqliteService);
const parserRegistry = new ParserRegistry();
const artifactStore = new ArtifactStore();
const jobBus = new JobBus(projectSession, artifactStore);
const importService = new ImportService(
  projectSession,
  sourceRegistry,
  parserRegistry,
  sqliteService,
);
const jobService = new JobService(
  projectSession,
  sourceRegistry,
  parserRegistry,
  artifactStore,
  jobBus,
  sqliteService,
);
const agentRunner = resolveAgentRunner();
const schemaCompileService = new SchemaCompileService(
  projectSession,
  sourceRegistry,
  artifactStore,
  jobBus,
  sqliteService,
  agentRunner,
);
const searchRunner = resolveSearchRunner();
const searchService = new SearchService(projectSession, sqliteService, searchRunner);

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
  registerAllIpcHandlers({
    session: projectSession,
    importService,
    jobService,
    schemaCompileService,
    searchService,
    jobBus,
    artifacts: artifactStore,
    sourceRegistry,
  });
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
