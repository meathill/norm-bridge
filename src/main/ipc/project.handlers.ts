import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerProjectHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  const { session } = deps;

  register('project:create', ({ directory, name }) => {
    return session.create({ directory, name });
  });

  register('project:open', ({ directory }) => {
    return session.open(directory);
  });

  register('project:close', () => {
    return { closed: session.close() };
  });

  register('project:status', () => {
    const current = session.getCurrent();
    return session.getFs().computeStatus(current);
  });
}
