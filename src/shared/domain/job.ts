/** TECH_SPEC §15.1 — initial job kinds for v0.1. */
export type JobKind = 'standard_extract' | 'schema_compile';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobInfo = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number; // 0..1
  message?: string;
  sourceId?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  /** Relative paths under the project artifacts/ directory. */
  artifactPaths: string[];
};

export type JobEventBase = {
  jobId: string;
  at: string;
};

export type JobEvent =
  | (JobEventBase & { type: 'started'; kind: JobKind; sourceId?: string })
  | (JobEventBase & { type: 'progress'; progress: number; message?: string })
  | (JobEventBase & {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
    })
  | (JobEventBase & { type: 'artifact_written'; path: string })
  | (JobEventBase & {
      type: 'finished';
      status: 'succeeded' | 'failed' | 'cancelled';
      error?: string;
    });

export type StartStandardExtractInput = {
  sourceId: string;
};

export type StartSchemaCompileInput = {
  sourceId: string;
  /** Override the default runner. If absent the service picks based on env. */
  runner?: 'mock' | 'openai';
};

export type StartJobResult = {
  jobId: string;
};
