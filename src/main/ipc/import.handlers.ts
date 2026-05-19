import type { HandlerRegistrar, IpcDeps } from './register-all';

export function registerImportHandlers(register: HandlerRegistrar, deps: IpcDeps): void {
  register('import:standard-pdf', async ({ filePath }) => {
    return deps.importService.importFile({ filePath, kind: 'standard_pdf' });
  });
}
