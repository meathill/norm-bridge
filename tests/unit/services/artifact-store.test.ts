import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@main/services/artifact-store';

describe('ArtifactStore', () => {
  let tmpRoot: string;
  let store: ArtifactStore;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-artifact-'));
    store = new ArtifactStore();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes JSON to artifacts/<scope>/<ownerId>/<name> and returns a project-relative ref', async () => {
    const project = { directory: tmpRoot };
    const ref = await store.writeJson(
      project,
      { scope: 'standards', ownerId: 'std_abc', name: 'pages.json' },
      { hello: 'world' },
    );

    expect(ref.relativePath).toBe('artifacts/standards/std_abc/pages.json');
    expect(ref.absolutePath).toContain('artifacts/standards/std_abc/pages.json');
    expect(statSync(ref.absolutePath).isFile()).toBe(true);
    expect(JSON.parse(readFileSync(ref.absolutePath, 'utf-8'))).toEqual({ hello: 'world' });
  });

  it('round-trips JSON via readJson', async () => {
    const project = { directory: tmpRoot };
    const key = { scope: 'standards' as const, ownerId: 'std_x', name: 'data.json' };
    await store.writeJson(project, key, { n: 42 });
    const read = await store.readJson<{ n: number }>(project, key);
    expect(read.n).toBe(42);
  });

  it('appendJsonl creates the file and adds one line per call', async () => {
    const project = { directory: tmpRoot };
    const key = { scope: 'jobs' as const, ownerId: 'job_42', name: 'events.jsonl' };
    await store.appendJsonl(project, key, { type: 'started' });
    await store.appendJsonl(project, key, { type: 'progress', p: 0.5 });
    await store.appendJsonl(project, key, { type: 'finished' });

    const content = readFileSync(join(tmpRoot, 'artifacts/jobs/job_42/events.jsonl'), 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual({ type: 'progress', p: 0.5 });
  });

  it('creates parent directories on first write', async () => {
    const project = { directory: tmpRoot };
    await store.writeJson(project, { scope: 'evidence', ownerId: 'evi_1', name: 'meta.json' }, {});
    expect(statSync(join(tmpRoot, 'artifacts/evidence/evi_1')).isDirectory()).toBe(true);
  });
});
