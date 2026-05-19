import { shell } from 'electron';
import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerSourceHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  const { sourceRegistry, session } = deps;

  register('source:list', ({ kind }) => {
    return sourceRegistry.list(kind);
  });

  register('system:open-source', async ({ sourceId }) => {
    const project = session.getCurrent();
    if (!project) throw new Error('No project is open.');
    const source = sourceRegistry.getById(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const abs = sourceRegistry.resolveAbsolutePath({ directory: project.directory }, source);
    const err = await shell.openPath(abs);
    if (err) throw new Error(`Failed to open: ${err}`);
    return { opened: true };
  });
}
