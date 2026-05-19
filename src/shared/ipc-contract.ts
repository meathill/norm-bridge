import type { ImportResult } from './domain/import-result';
import type { ProjectInfo, ProjectStatus } from './domain/project';

/**
 * Single source of truth for renderer ↔ main IPC channels.
 * Main registers handlers keyed by these strings; preload exposes a typed facade.
 */
export type IpcContract = {
  'app:ping': { req: void; res: { ok: true; version: string } };
  'dialog:pick-directory': {
    req: { title?: string };
    res: { canceled: boolean; directory: string | null };
  };
  'dialog:pick-files': {
    req: { title?: string; filters?: Array<{ name: string; extensions: string[] }> };
    res: { canceled: boolean; filePaths: string[] };
  };
  'project:create': {
    req: { directory: string; name: string };
    res: ProjectInfo;
  };
  'project:open': {
    req: { directory: string };
    res: ProjectInfo;
  };
  'project:close': { req: void; res: { closed: boolean } };
  'project:status': { req: void; res: ProjectStatus };
  'import:standard-pdf': {
    req: { filePath: string };
    res: ImportResult;
  };
};

export type IpcChannel = keyof IpcContract;
export type IpcReq<K extends IpcChannel> = IpcContract[K]['req'];
export type IpcRes<K extends IpcChannel> = IpcContract[K]['res'];

export type NbApi = {
  app: {
    ping(): Promise<IpcRes<'app:ping'>>;
  };
  dialog: {
    pickDirectory(req: IpcReq<'dialog:pick-directory'>): Promise<IpcRes<'dialog:pick-directory'>>;
    pickFiles(req: IpcReq<'dialog:pick-files'>): Promise<IpcRes<'dialog:pick-files'>>;
  };
  project: {
    create(req: IpcReq<'project:create'>): Promise<IpcRes<'project:create'>>;
    open(req: IpcReq<'project:open'>): Promise<IpcRes<'project:open'>>;
    close(): Promise<IpcRes<'project:close'>>;
    status(): Promise<IpcRes<'project:status'>>;
  };
  import: {
    standardPdf(req: IpcReq<'import:standard-pdf'>): Promise<IpcRes<'import:standard-pdf'>>;
  };
  /**
   * Renderer-side helper. Calls Electron's webUtils.getPathForFile on a File object
   * received from a drag-and-drop event. Synchronous in Electron 32+; we wrap it in
   * preload because webUtils is not exposed by the renderer process itself.
   */
  files: {
    getPathForFile(file: File): string;
  };
};
