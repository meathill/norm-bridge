import { ipcMain } from 'electron';
import type { IpcChannel, IpcContract } from '@shared/ipc-contract';
import type { ImportService } from '@main/services/import-service';
import type { ProjectSession } from '@main/services/project-session';
import { registerProjectHandlers } from './project.handlers';
import { registerDialogHandlers } from './dialog.handlers';
import { registerAppHandlers } from './app.handlers';
import { registerImportHandlers } from './import.handlers';

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
};

export function registerAllIpcHandlers(deps: IpcDeps): void {
  registerAppHandlers(handlerRegistrar);
  registerDialogHandlers(handlerRegistrar);
  registerProjectHandlers(handlerRegistrar, deps);
  registerImportHandlers(handlerRegistrar, deps);
}
