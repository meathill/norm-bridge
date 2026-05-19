import { create } from 'zustand';
import type { IpcRes } from '@shared/ipc-contract';

type RuntimeStatus = IpcRes<'config:status'>;

type RuntimeStoreState = {
  status: RuntimeStatus | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<RuntimeStatus | null>;
};

export const useRuntimeStore = create<RuntimeStoreState>((set) => ({
  status: null,
  loading: false,
  error: null,
  async refresh() {
    set({ loading: true, error: null });
    try {
      const status = await window.nb.config.status();
      set({ status, loading: false });
      return status;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
}));
