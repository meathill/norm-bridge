import { create } from 'zustand';

type SelectionStoreState = {
  selectedSourceId: string | null;
  selectedJobId: string | null;
  setSelectedSource(sourceId: string | null): void;
  setSelectedJob(jobId: string | null): void;
};

export const useSelectionStore = create<SelectionStoreState>((set) => ({
  selectedSourceId: null,
  selectedJobId: null,
  setSelectedSource(sourceId) {
    set({ selectedSourceId: sourceId });
  },
  setSelectedJob(jobId) {
    set({ selectedJobId: jobId });
  },
}));
