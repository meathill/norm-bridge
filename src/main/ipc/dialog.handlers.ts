import { BrowserWindow, dialog } from 'electron';
import type { HandlerRegistrar } from './register-all';

export function registerDialogHandlers(register: HandlerRegistrar): void {
  register('dialog:pick-directory', async ({ title }) => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: title ?? 'Select a directory',
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          title: title ?? 'Select a directory',
          properties: ['openDirectory', 'createDirectory'],
        });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directory: null };
    }
    return { canceled: false, directory: result.filePaths[0] ?? null };
  });
}
