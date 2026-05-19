import { create } from 'zustand';
import type { ProjectInfo, ProjectStatus } from '@shared/domain/project';

type ProjectStoreState = {
  status: ProjectStatus | null;
  loading: boolean;
  error: string | null;
  current: ProjectInfo | null;

  refresh(): Promise<void>;
  createProject(input: { directory: string; name: string }): Promise<ProjectInfo>;
  openProject(input: { directory: string }): Promise<ProjectInfo>;
  closeProject(): Promise<void>;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useProjectStore = create<ProjectStoreState>((set, _get) => ({
  status: null,
  loading: false,
  error: null,
  current: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const status = await window.nb.project.status();
      set({ status, current: status.project, loading: false });
    } catch (err) {
      set({ error: toMessage(err), loading: false });
    }
  },

  async createProject({ directory, name }) {
    set({ loading: true, error: null });
    try {
      const info = await window.nb.project.create({ directory, name });
      const status = await window.nb.project.status();
      set({ status, current: info, loading: false });
      return info;
    } catch (err) {
      set({ error: toMessage(err), loading: false });
      throw err;
    }
  },

  async openProject({ directory }) {
    set({ loading: true, error: null });
    try {
      const info = await window.nb.project.open({ directory });
      const status = await window.nb.project.status();
      set({ status, current: info, loading: false });
      return info;
    } catch (err) {
      set({ error: toMessage(err), loading: false });
      throw err;
    }
  },

  async closeProject() {
    set({ loading: true, error: null });
    try {
      await window.nb.project.close();
      const status = await window.nb.project.status();
      set({ status, current: null, loading: false });
    } catch (err) {
      set({ error: toMessage(err), loading: false });
    }
  },
}));
