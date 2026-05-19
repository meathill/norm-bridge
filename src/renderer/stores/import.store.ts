import { create } from 'zustand';
import type { ImportResult } from '@shared/domain/import-result';

type ImportStoreState = {
  /** Imports performed during the current session, newest first. */
  recent: ImportResult[];
  importing: boolean;
  error: string | null;

  importStandardPdf(filePath: string): Promise<ImportResult>;
  clearError(): void;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useImportStore = create<ImportStoreState>((set, get) => ({
  recent: [],
  importing: false,
  error: null,

  async importStandardPdf(filePath) {
    set({ importing: true, error: null });
    try {
      const result = await window.nb.import.standardPdf({ filePath });
      const dedup = get().recent.filter((r) => r.source.id !== result.source.id);
      set({ recent: [result, ...dedup], importing: false });
      return result;
    } catch (err) {
      set({ error: toMessage(err), importing: false });
      throw err;
    }
  },

  clearError() {
    set({ error: null });
  },
}));
