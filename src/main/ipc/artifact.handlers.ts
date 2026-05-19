import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerArtifactHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  const { artifacts, session } = deps;

  register('artifact:read-json', async ({ scope, ownerId, name }) => {
    const project = session.getCurrent();
    if (!project) {
      throw new Error('No project is open.');
    }
    return artifacts.readJson(project, { scope, ownerId, name });
  });
}
