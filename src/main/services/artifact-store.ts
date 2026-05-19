import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix, relative, resolve } from 'node:path';

/** TECH_SPEC §8 — top-level artifact scopes. */
export type ArtifactScope = 'standards' | 'inputs' | 'evidence' | 'jobs';

export type ArtifactRef = {
  scope: ArtifactScope;
  /** Owner id, e.g. source id, evidence id, or job id. */
  ownerId: string;
  /** File name relative to artifacts/&lt;scope&gt;/&lt;ownerId&gt;/. */
  name: string;
  /** Project-relative POSIX path under artifacts/, e.g. "artifacts/jobs/job_x/events.jsonl". */
  relativePath: string;
  absolutePath: string;
};

export type ProjectLike = { directory: string };

type ArtifactKey = {
  scope: ArtifactScope;
  ownerId: string;
  name: string;
};

export class ArtifactStore {
  resolveDir(project: ProjectLike, scope: ArtifactScope, ownerId: string): string {
    return resolve(project.directory, 'artifacts', scope, ownerId);
  }

  resolveFile(project: ProjectLike, key: ArtifactKey): string {
    return resolve(this.resolveDir(project, key.scope, key.ownerId), key.name);
  }

  async writeJson(project: ProjectLike, key: ArtifactKey, data: unknown): Promise<ArtifactRef> {
    const dir = this.resolveDir(project, key.scope, key.ownerId);
    await mkdir(dir, { recursive: true });
    const abs = resolve(dir, key.name);
    await writeFile(abs, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    return this.makeRef(project, key, abs);
  }

  async appendJsonl(project: ProjectLike, key: ArtifactKey, entry: unknown): Promise<ArtifactRef> {
    const dir = this.resolveDir(project, key.scope, key.ownerId);
    await mkdir(dir, { recursive: true });
    const abs = resolve(dir, key.name);
    await appendFile(abs, `${JSON.stringify(entry)}\n`, 'utf-8');
    return this.makeRef(project, key, abs);
  }

  async readJson<T>(project: ProjectLike, key: ArtifactKey): Promise<T> {
    const abs = this.resolveFile(project, key);
    const raw = await readFile(abs, 'utf-8');
    return JSON.parse(raw) as T;
  }

  private makeRef(project: ProjectLike, key: ArtifactKey, absolutePath: string): ArtifactRef {
    const artifactsRoot = resolve(project.directory, 'artifacts');
    const rel = relative(artifactsRoot, absolutePath).split(/[/\\]/);
    return {
      scope: key.scope,
      ownerId: key.ownerId,
      name: key.name,
      relativePath: posix.join('artifacts', ...rel),
      absolutePath,
    };
  }
}
