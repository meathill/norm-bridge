import { app } from 'electron';
import type { HandlerRegistrar } from './register-all';

export function registerAppHandlers(register: HandlerRegistrar): void {
  register('app:ping', () => ({ ok: true, version: app.getVersion() }));
}
