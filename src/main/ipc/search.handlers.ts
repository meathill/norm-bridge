import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerSearchHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  register('search:query', (req) => deps.searchService.query(req));
}
