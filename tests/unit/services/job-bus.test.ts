import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@main/services/artifact-store';
import { JobBus } from '@main/services/job-bus';
import { ProjectFs } from '@main/services/project-fs';
import { ProjectSession } from '@main/services/project-session';
import { SqliteService } from '@main/services/sqlite-service';
import type { JobEvent } from '@shared/domain/job';

describe('JobBus', () => {
  let tmpRoot: string;
  let projectDir: string;
  let fs: ProjectFs;
  let sqlite: SqliteService;
  let session: ProjectSession;
  let artifacts: ArtifactStore;
  let bus: JobBus;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-jobbus-'));
    projectDir = join(tmpRoot, 'project');
    fs = new ProjectFs();
    sqlite = new SqliteService();
    session = new ProjectSession(fs, sqlite);
    session.create({ directory: projectDir, name: 'T' });
    artifacts = new ArtifactStore();
    bus = new JobBus(session, artifacts);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a job, emits started + progress + finished, returns info on getJob', async () => {
    const seen: JobEvent[] = [];
    const off = bus.on((e) => seen.push(e));

    const handle = await bus.create({ kind: 'standard_extract', sourceId: 'src_demo' });
    await handle.emitProgress(0.5, 'halfway');
    await handle.finishSuccess();
    off();

    expect(seen.map((e) => e.type)).toEqual(['started', 'progress', 'finished']);

    const info = bus.getJob(handle.id);
    expect(info?.status).toBe('succeeded');
    expect(info?.progress).toBe(1);
    expect(info?.sourceId).toBe('src_demo');
  });

  it('persists events to artifacts/jobs/<id>/events.jsonl with the same payload', async () => {
    const handle = await bus.create({ kind: 'standard_extract', sourceId: 'src_x' });
    await handle.emitLog('warn', 'something fishy');
    await handle.emitArtifactWritten('artifacts/standards/src_x/pages.json');
    await handle.finishSuccess();

    const path = join(projectDir, 'artifacts', 'jobs', handle.id, 'events.jsonl');
    const lines = readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['started', 'log', 'artifact_written', 'finished']);
    expect(lines[1].level).toBe('warn');
    expect(lines[2].path).toBe('artifacts/standards/src_x/pages.json');
  });

  it('finishFailure records the error and emits status=failed', async () => {
    const handle = await bus.create({ kind: 'standard_extract', sourceId: 'src_y' });
    await handle.finishFailure(new Error('boom'));

    const info = bus.getJob(handle.id);
    expect(info?.status).toBe('failed');
    expect(info?.error).toBe('boom');
  });

  it('listJobs filters by sourceId', async () => {
    const a = await bus.create({ kind: 'standard_extract', sourceId: 'src_a' });
    await bus.create({ kind: 'standard_extract', sourceId: 'src_b' });
    await a.finishSuccess();

    const filtered = bus.listJobs({ sourceId: 'src_a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.sourceId).toBe('src_a');
  });

  it('writes plan.json when planPayload is supplied', async () => {
    const handle = await bus.create({
      kind: 'standard_extract',
      sourceId: 'src_p',
      planPayload: { description: 'extract', sampleCount: 3 },
    });
    const plan = JSON.parse(
      readFileSync(join(projectDir, 'artifacts/jobs', handle.id, 'plan.json'), 'utf-8'),
    );
    expect(plan).toEqual({ description: 'extract', sampleCount: 3 });
  });
});
