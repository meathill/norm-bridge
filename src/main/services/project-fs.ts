import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { newId } from '@shared/ids';
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectConfig,
  type ProjectInfo,
  type ProjectStatus,
} from '@shared/domain/project';
import { projectConfigSchema } from '@shared/schemas/project';

export const PROJECT_CONFIG_FILE = 'normbridge.project.json';

/**
 * TECH_SPEC §5 — local project layout. Each entry is a directory relative to the project root.
 * Order matters only insofar as it controls the visible directory listing on disk.
 */
const PROJECT_DIRECTORIES: readonly string[] = [
  'sources',
  'sources/standards',
  'sources/inputs',
  'sources/evidence',
  'sources/evidence/certificates',
  'sources/evidence/test-reports',
  'sources/evidence/product-specs',
  'artifacts',
  'artifacts/standards',
  'artifacts/inputs',
  'artifacts/evidence',
  'artifacts/jobs',
  'db',
  'review',
  'reports',
];

export type CreateProjectInput = {
  directory: string;
  name: string;
  defaultLocale?: string;
  agentProfile?: string;
};

export class ProjectError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'directory_not_empty'
      | 'config_missing'
      | 'config_invalid'
      | 'directory_not_writable'
      | 'directory_missing',
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

export class ProjectFs {
  createProject(input: CreateProjectInput): ProjectInfo {
    const directory = resolve(input.directory);

    mkdirSync(directory, { recursive: true });

    if (this.hasProjectConfig(directory)) {
      throw new ProjectError(
        `Directory already contains a NormBridge project: ${directory}`,
        'directory_not_empty',
      );
    }

    this.ensureProjectDirectories(directory);

    const now = new Date().toISOString();
    const config: ProjectConfig = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: newId('project'),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      defaultLocale: input.defaultLocale ?? 'en',
      agentProfile: input.agentProfile ?? 'standard-index-v0.1',
      dbPath: 'db/normbridge.sqlite',
    };

    this.writeConfig(directory, config);
    return { config, directory };
  }

  openProject(directory: string): ProjectInfo {
    const resolved = resolve(directory);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new ProjectError(`Project directory does not exist: ${resolved}`, 'directory_missing');
    }
    const config = this.readConfig(resolved);
    // Make sure all required subdirectories exist (in case the user synced from a partial backup).
    this.ensureProjectDirectories(resolved);
    return { config, directory: resolved };
  }

  hasProjectConfig(directory: string): boolean {
    return existsSync(join(directory, PROJECT_CONFIG_FILE));
  }

  resolvePath(
    project: ProjectInfo,
    kind: 'source' | 'artifact' | 'db' | 'review' | 'report',
    ...parts: string[]
  ): string {
    const root = project.directory;
    const head = {
      source: 'sources',
      artifact: 'artifacts',
      db: 'db',
      review: 'review',
      report: 'reports',
    }[kind];
    return resolve(root, head, ...parts);
  }

  resolveDbPath(project: ProjectInfo): string {
    return resolve(project.directory, project.config.dbPath);
  }

  computeStatus(project: ProjectInfo | null): ProjectStatus {
    if (!project) {
      return {
        hasOpenProject: false,
        project: null,
        counts: { standards: 0, inputs: 0, evidence: 0, jobs: 0 },
      };
    }
    return {
      hasOpenProject: true,
      project,
      counts: {
        standards: this.safeCountDir(this.resolvePath(project, 'source', 'standards')),
        inputs: this.safeCountDir(this.resolvePath(project, 'source', 'inputs')),
        evidence: this.safeCountDir(this.resolvePath(project, 'source', 'evidence'), {
          countSubtreeFiles: true,
        }),
        jobs: this.safeCountDir(this.resolvePath(project, 'artifact', 'jobs')),
      },
    };
  }

  private writeConfig(directory: string, config: ProjectConfig): void {
    const path = join(directory, PROJECT_CONFIG_FILE);
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  }

  private readConfig(directory: string): ProjectConfig {
    const path = join(directory, PROJECT_CONFIG_FILE);
    if (!existsSync(path)) {
      throw new ProjectError(`Missing ${PROJECT_CONFIG_FILE} in ${directory}`, 'config_missing');
    }
    const raw = readFileSync(path, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProjectError(
        `Invalid JSON in ${PROJECT_CONFIG_FILE}: ${(err as Error).message}`,
        'config_invalid',
      );
    }
    const result = projectConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ProjectError(
        `Invalid project config: ${result.error.issues.map((i) => i.message).join('; ')}`,
        'config_invalid',
      );
    }
    return result.data as ProjectConfig;
  }

  private ensureProjectDirectories(directory: string): void {
    for (const sub of PROJECT_DIRECTORIES) {
      mkdirSync(join(directory, sub), { recursive: true });
    }
  }

  private safeCountDir(dir: string, options?: { countSubtreeFiles?: boolean }): number {
    if (!existsSync(dir)) return 0;
    try {
      if (!options?.countSubtreeFiles) {
        return readdirSync(dir).filter((entry) => !entry.startsWith('.')).length;
      }
      let count = 0;
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          count += this.safeCountDir(full, options);
        } else {
          count += 1;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }
}
