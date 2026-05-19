import { getRuntimeStatus } from '@agents/runtime-config';
import type { HandlerRegistrar } from './register-all';

export function registerConfigHandlers(register: HandlerRegistrar): void {
  register('config:status', () => {
    const status = getRuntimeStatus();
    // Drop undefined keys so the IPC payload stays clean (the contract uses optional errorMessage).
    const base = {
      ready: status.ready,
      apiKeyMasked: status.apiKeyMasked,
      baseURL: status.baseURL,
      compileModel: status.compileModel,
      searchModel: status.searchModel,
    };
    return status.errorMessage !== undefined
      ? { ...base, errorMessage: status.errorMessage }
      : base;
  });
}
