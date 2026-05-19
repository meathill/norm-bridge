import { EventEmitter } from 'node:events';
import { newId } from '@shared/ids';
import type { JobEvent, JobInfo, JobKind, JobStatus } from '@shared/domain/job';
import type { ArtifactStore } from './artifact-store';
import type { ProjectSession } from './project-session';

const EVENTS_FILE = 'events.jsonl';
const PLAN_FILE = 'plan.json';

export type JobHandle = {
  readonly id: string;
  emitProgress(progress: number, message?: string): Promise<void>;
  emitLog(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
  emitArtifactWritten(path: string): Promise<void>;
  finishSuccess(): Promise<void>;
  finishFailure(error: Error): Promise<void>;
};

export type CreateJobInput = {
  kind: JobKind;
  sourceId?: string;
  planPayload?: unknown;
};

/**
 * Owns job lifecycle: in-memory state + JSONL persistence + event broadcast.
 * Renderer-side delivery (webContents.send) is handled by the IPC layer subscribing
 * to the local 'event' emitter exposed via on().
 */
export class JobBus {
  private readonly jobs = new Map<string, JobInfo>();
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly session: ProjectSession,
    private readonly artifacts: ArtifactStore,
  ) {
    this.emitter.setMaxListeners(50);
  }

  on(handler: (event: JobEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  getJob(jobId: string): JobInfo | null {
    return this.jobs.get(jobId) ?? null;
  }

  listJobs(filter?: { kind?: JobKind; sourceId?: string }): JobInfo[] {
    return Array.from(this.jobs.values())
      .filter((j) => !filter?.kind || j.kind === filter.kind)
      .filter((j) => !filter?.sourceId || j.sourceId === filter.sourceId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async create(input: CreateJobInput): Promise<JobHandle> {
    const project = this.session.getCurrent();
    if (!project) {
      throw new Error('Cannot create a job: no project is open.');
    }
    const id = newId('job');
    const now = new Date().toISOString();
    const info: JobInfo = {
      id,
      kind: input.kind,
      status: 'running',
      progress: 0,
      ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
      startedAt: now,
      artifactPaths: [],
    };
    this.jobs.set(id, info);

    if (input.planPayload !== undefined) {
      await this.artifacts.writeJson(
        project,
        { scope: 'jobs', ownerId: id, name: PLAN_FILE },
        input.planPayload,
      );
    }

    const startedEvent: JobEvent = input.sourceId
      ? { type: 'started', jobId: id, at: now, kind: input.kind, sourceId: input.sourceId }
      : { type: 'started', jobId: id, at: now, kind: input.kind };
    await this.persistEvent(id, startedEvent);
    this.emitter.emit('event', startedEvent);

    return this.makeHandle(id);
  }

  private makeHandle(jobId: string): JobHandle {
    return {
      id: jobId,
      emitProgress: async (progress: number, message?: string) => {
        const info = this.jobs.get(jobId);
        if (!info) return;
        info.progress = Math.max(0, Math.min(1, progress));
        if (message !== undefined) info.message = message;
        const event: JobEvent =
          message !== undefined
            ? {
                type: 'progress',
                jobId,
                at: new Date().toISOString(),
                progress: info.progress,
                message,
              }
            : { type: 'progress', jobId, at: new Date().toISOString(), progress: info.progress };
        await this.persistEvent(jobId, event);
        this.emitter.emit('event', event);
      },
      emitLog: async (level, message) => {
        const event: JobEvent = {
          type: 'log',
          jobId,
          at: new Date().toISOString(),
          level,
          message,
        };
        await this.persistEvent(jobId, event);
        this.emitter.emit('event', event);
      },
      emitArtifactWritten: async (path: string) => {
        const info = this.jobs.get(jobId);
        if (info && !info.artifactPaths.includes(path)) {
          info.artifactPaths.push(path);
        }
        const event: JobEvent = {
          type: 'artifact_written',
          jobId,
          at: new Date().toISOString(),
          path,
        };
        await this.persistEvent(jobId, event);
        this.emitter.emit('event', event);
      },
      finishSuccess: async () => {
        await this.finalize(jobId, 'succeeded');
      },
      finishFailure: async (error: Error) => {
        await this.finalize(jobId, 'failed', error);
      },
    };
  }

  private async finalize(
    jobId: string,
    status: Exclude<JobStatus, 'queued' | 'running'>,
    error?: Error,
  ): Promise<void> {
    const info = this.jobs.get(jobId);
    if (!info) return;
    info.status = status;
    info.finishedAt = new Date().toISOString();
    if (status === 'succeeded') {
      info.progress = 1;
    }
    if (error) {
      info.error = error.message;
    }
    const event: JobEvent = error
      ? {
          type: 'finished',
          jobId,
          at: info.finishedAt,
          status,
          error: error.message,
        }
      : { type: 'finished', jobId, at: info.finishedAt, status };
    await this.persistEvent(jobId, event);
    this.emitter.emit('event', event);
  }

  private async persistEvent(jobId: string, event: JobEvent): Promise<void> {
    const project = this.session.getCurrent();
    if (!project) return; // a job that outlived its project is unusual but not fatal
    await this.artifacts.appendJsonl(
      project,
      { scope: 'jobs', ownerId: jobId, name: EVENTS_FILE },
      event,
    );
  }
}
