import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcChannel, IpcReq, IpcRes, NbApi } from '@shared/ipc-contract';

function invoke<K extends IpcChannel>(channel: K, req: IpcReq<K>): Promise<IpcRes<K>> {
  return ipcRenderer.invoke(channel, req) as Promise<IpcRes<K>>;
}

const api: NbApi = {
  app: {
    ping: () => invoke('app:ping', undefined as never),
  },
  dialog: {
    pickDirectory: (req) => invoke('dialog:pick-directory', req),
    pickFiles: (req) => invoke('dialog:pick-files', req),
  },
  project: {
    create: (req) => invoke('project:create', req),
    open: (req) => invoke('project:open', req),
    close: () => invoke('project:close', undefined as never),
    status: () => invoke('project:status', undefined as never),
  },
  import: {
    standardPdf: (req) => invoke('import:standard-pdf', req),
  },
  files: {
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('nb', api);
