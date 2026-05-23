import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerJobHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  const { jobService, schemaCompileService } = deps;

  register('job:start-standard-extract', ({ sourceId }) => {
    return jobService.startStandardExtract({ sourceId });
  });

  register('job:start-schema-compile', ({ sourceId }) => {
    return schemaCompileService.start({ sourceId });
  });

  register('standard:list-compiled', () => {
    return schemaCompileService.listCompiled();
  });

  register('job:get', ({ jobId }) => {
    return jobService.getJob(jobId);
  });

  register('job:list', ({ kind, sourceId }) => {
    const filter: { kind?: typeof kind; sourceId?: typeof sourceId } = {};
    if (kind !== undefined) filter.kind = kind;
    if (sourceId !== undefined) filter.sourceId = sourceId;
    return jobService.listJobs(filter);
  });
}
