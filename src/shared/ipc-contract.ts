import type { ImportResult } from './domain/import-result';
import type {
  JobEvent,
  JobInfo,
  JobKind,
  StartJobResult,
  StartStandardExtractInput,
} from './domain/job';
import type { ProjectInfo, ProjectStatus } from './domain/project';
import type { SearchQueryInput, SearchQueryResult } from './domain/search';
import type { SourceFile } from './domain/source';

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
  'job:start-standard-extract': {
    req: StartStandardExtractInput;
    res: StartJobResult;
  };
  'job:start-schema-compile': {
    req: { sourceId: string };
    res: StartJobResult;
  };
  'job:get': { req: { jobId: string }; res: JobInfo | null };
  'job:list': { req: { kind?: JobKind; sourceId?: string }; res: JobInfo[] };
  /** Reads a JSON artifact at artifacts/&lt;scope&gt;/&lt;ownerId&gt;/&lt;name&gt; for the renderer to display. */
  'artifact:read-json': {
    req: { scope: 'standards' | 'inputs' | 'evidence' | 'jobs'; ownerId: string; name: string };
    res: unknown;
  };
  /** Lists registered sources (optionally filtered by kind). */
  'source:list': {
    req: {
      kind?:
        | 'standard_pdf'
        | 'excel_input'
        | 'certificate'
        | 'test_report'
        | 'product_spec'
        | 'datasheet'
        | 'report_template';
    };
    res: SourceFile[];
  };
  /** Opens an imported source in the OS default viewer. */
  'system:open-source': {
    req: { sourceId: string };
    res: { opened: boolean };
  };
  /** Natural-language product query against the compiled schema. */
  'search:query': {
    req: SearchQueryInput;
    res: SearchQueryResult;
  };
  /** Reports whether the LLM runtime is configured (key, endpoint, model). */
  'config:status': {
    req: void;
    res: {
      ready: boolean;
      apiKeyMasked: string | null;
      baseURL: string | null;
      compileModel: string;
      searchModel: string;
      errorMessage?: string;
    };
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
  job: {
    startStandardExtract(
      req: IpcReq<'job:start-standard-extract'>,
    ): Promise<IpcRes<'job:start-standard-extract'>>;
    startSchemaCompile(
      req: IpcReq<'job:start-schema-compile'>,
    ): Promise<IpcRes<'job:start-schema-compile'>>;
    get(req: IpcReq<'job:get'>): Promise<IpcRes<'job:get'>>;
    list(req: IpcReq<'job:list'>): Promise<IpcRes<'job:list'>>;
    onEvent(handler: (event: JobEvent) => void): () => void;
  };
  artifact: {
    readJson<T = unknown>(req: IpcReq<'artifact:read-json'>): Promise<T>;
  };
  source: {
    list(req: IpcReq<'source:list'>): Promise<IpcRes<'source:list'>>;
  };
  system: {
    openSource(req: IpcReq<'system:open-source'>): Promise<IpcRes<'system:open-source'>>;
  };
  search: {
    query(req: IpcReq<'search:query'>): Promise<IpcRes<'search:query'>>;
  };
  config: {
    status(): Promise<IpcRes<'config:status'>>;
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
