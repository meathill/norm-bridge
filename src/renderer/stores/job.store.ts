import { create } from 'zustand';
import type { JobEvent, JobInfo } from '@shared/domain/job';

type JobStoreState = {
  jobs: Record<string, JobInfo>;
  subscribed: boolean;
  /** Most recent event per job, for showing "current step" messages. */
  lastEvent: Record<string, JobEvent>;

  ensureSubscribed(): void;
  refreshJob(jobId: string): Promise<void>;
  refreshList(filter?: { sourceId?: string }): Promise<void>;
  startStandardExtract(sourceId: string): Promise<string>;
  startSchemaCompile(sourceId: string): Promise<string>;
};

let unsubscribe: (() => void) | null = null;

export const useJobStore = create<JobStoreState>((set, get) => ({
  jobs: {},
  subscribed: false,
  lastEvent: {},

  ensureSubscribed() {
    if (get().subscribed) return;
    set({ subscribed: true });
    unsubscribe?.();
    unsubscribe = window.nb.job.onEvent((event) => {
      const current = get();
      const existing = current.jobs[event.jobId] ?? null;

      const nextJobs = { ...current.jobs };
      const nextEvents = { ...current.lastEvent, [event.jobId]: event };

      if (event.type === 'progress') {
        if (existing) {
          const updated: JobInfo =
            event.message !== undefined
              ? { ...existing, progress: event.progress, message: event.message }
              : { ...existing, progress: event.progress };
          nextJobs[event.jobId] = updated;
        }
      } else if (event.type === 'artifact_written') {
        if (existing) {
          const paths = existing.artifactPaths.includes(event.path)
            ? existing.artifactPaths
            : [...existing.artifactPaths, event.path];
          nextJobs[event.jobId] = { ...existing, artifactPaths: paths };
        }
      } else if (event.type === 'finished') {
        if (existing) {
          const finished: JobInfo = {
            ...existing,
            status: event.status,
            finishedAt: event.at,
            progress: event.status === 'succeeded' ? 1 : existing.progress,
            ...(event.error ? { error: event.error } : {}),
          };
          nextJobs[event.jobId] = finished;
        } else {
          // race: 'finished' arrived before we cached the info. Fetch on demand.
          void get().refreshJob(event.jobId);
        }
      }
      set({ jobs: nextJobs, lastEvent: nextEvents });
    });
  },

  async refreshJob(jobId) {
    const info = await window.nb.job.get({ jobId });
    if (info) {
      set((state) => ({ jobs: { ...state.jobs, [jobId]: info } }));
    }
  },

  async refreshList(filter) {
    const list = await window.nb.job.list(filter ?? {});
    const indexed: Record<string, JobInfo> = {};
    for (const j of list) indexed[j.id] = j;
    set({ jobs: indexed });
  },

  async startStandardExtract(sourceId) {
    get().ensureSubscribed();
    const { jobId } = await window.nb.job.startStandardExtract({ sourceId });
    await get().refreshJob(jobId);
    return jobId;
  },

  async startSchemaCompile(sourceId) {
    get().ensureSubscribed();
    const { jobId } = await window.nb.job.startSchemaCompile({ sourceId });
    await get().refreshJob(jobId);
    return jobId;
  },
}));
