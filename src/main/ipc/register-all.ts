import { BrowserWindow, ipcMain } from 'electron';
import type { IpcChannel, IpcContract } from '@shared/ipc-contract';
import type { ArtifactStore } from '@main/services/artifact-store';
import type { ImportService } from '@main/services/import-service';
import type { JobBus } from '@main/services/job-bus';
import type { JobService } from '@main/services/job-service';
import type { ProjectSession } from '@main/services/project-session';
import type { SchemaCompileService } from '@main/services/schema-compile-service';
import type { SearchService } from '@main/services/search-service';
import type { SourceRegistry } from '@main/services/source-registry';
import { registerProjectHandlers } from './project.handlers';
import { registerDialogHandlers } from './dialog.handlers';
import { registerAppHandlers } from './app.handlers';
import { registerImportHandlers } from './import.handlers';
import { registerJobHandlers } from './job.handlers';
import { registerArtifactHandlers } from './artifact.handlers';
import { registerSourceHandlers } from './source.handlers';
import { registerSearchHandlers } from './search.handlers';
import { registerConfigHandlers } from './config.handlers';

export type IpcHandler<K extends IpcChannel> = (
  req: IpcContract[K]['req'],
) => Promise<IpcContract[K]['res']> | IpcContract[K]['res'];

export type HandlerRegistrar = <K extends IpcChannel>(channel: K, handler: IpcHandler<K>) => void;

const handlerRegistrar: HandlerRegistrar = (channel, handler) => {
  ipcMain.handle(channel, async (_event, req) => handler(req as never));
};

export type IpcDeps = {
  session: ProjectSession;
  importService: ImportService;
  jobService: JobService;
  schemaCompileService: SchemaCompileService;
  searchService: SearchService;
  jobBus: JobBus;
  artifacts: ArtifactStore;
  sourceRegistry: SourceRegistry;
};

export function registerAllIpcHandlers(deps: IpcDeps): void {
  registerAppHandlers(handlerRegistrar);
  registerDialogHandlers(handlerRegistrar);
  registerProjectHandlers(handlerRegistrar, deps);
  registerImportHandlers(handlerRegistrar, deps);
  registerJobHandlers(handlerRegistrar, deps);
  registerArtifactHandlers(handlerRegistrar, deps);
  registerSourceHandlers(handlerRegistrar, deps);
  registerSearchHandlers(handlerRegistrar, deps);
  registerConfigHandlers(handlerRegistrar);

  // Bridge JobBus events to every renderer window. Multiple windows is unusual in
  // v0.1 but cheap to support correctly.
  deps.jobBus.on((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('job:event', event);
      }
    }
  });
}
