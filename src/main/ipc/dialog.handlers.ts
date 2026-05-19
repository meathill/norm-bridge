import { BrowserWindow, dialog } from 'electron';
import type { HandlerRegistrar } from './register-all';

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerDialogHandlers(register: HandlerRegistrar): void {
  register('dialog:pick-directory', async ({ title }) => {
    const parent = activeWindow();
    const options: Electron.OpenDialogOptions = {
      title: title ?? 'Select a directory',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directory: null };
    }
    return { canceled: false, directory: result.filePaths[0] ?? null };
  });

  register('dialog:pick-files', async ({ title, filters }) => {
    const parent = activeWindow();
    const options: Electron.OpenDialogOptions = {
      title: title ?? 'Select files',
      properties: ['openFile', 'multiSelections'],
      ...(filters ? { filters } : {}),
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) {
      return { canceled: true, filePaths: [] };
    }
    return { canceled: false, filePaths: result.filePaths };
  });
}
