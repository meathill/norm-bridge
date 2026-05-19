import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectFs, ProjectError, PROJECT_CONFIG_FILE } from '@main/services/project-fs';

describe('ProjectFs', () => {
  let tmpRoot: string;
  let fs: ProjectFs;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-projectfs-'));
    fs = new ProjectFs();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates the full directory skeleton + project config', () => {
    const dir = join(tmpRoot, 'project-a');
    const info = fs.createProject({ directory: dir, name: 'Project A' });

    expect(info.directory).toBe(dir);
    expect(info.config.name).toBe('Project A');
    expect(info.config.schemaVersion).toBe('0.1');
    expect(info.config.projectId).toMatch(/^proj_/);

    expect(statSync(join(dir, PROJECT_CONFIG_FILE)).isFile()).toBe(true);
    for (const sub of [
      'sources/standards',
      'sources/inputs',
      'sources/evidence/certificates',
      'sources/evidence/test-reports',
      'sources/evidence/product-specs',
      'artifacts/standards',
      'artifacts/inputs',
      'artifacts/evidence',
      'artifacts/jobs',
      'db',
      'review',
      'reports',
    ]) {
      expect(statSync(join(dir, sub)).isDirectory()).toBe(true);
    }
  });

  it('refuses to create on top of an existing project', () => {
    const dir = join(tmpRoot, 'project-b');
    fs.createProject({ directory: dir, name: 'Project B' });
    expect(() => fs.createProject({ directory: dir, name: 'Project B again' })).toThrow(
      ProjectError,
    );
  });

  it('openProject returns the same info that was written', () => {
    const dir = join(tmpRoot, 'project-c');
    const created = fs.createProject({ directory: dir, name: 'C' });
    const opened = fs.openProject(dir);
    expect(opened.config.projectId).toBe(created.config.projectId);
    expect(opened.config.createdAt).toBe(created.config.createdAt);
  });

  it('openProject restores missing subdirectories', () => {
    const dir = join(tmpRoot, 'project-d');
    fs.createProject({ directory: dir, name: 'D' });
    rmSync(join(dir, 'artifacts'), { recursive: true });
    const opened = fs.openProject(dir);
    expect(statSync(join(opened.directory, 'artifacts/standards')).isDirectory()).toBe(true);
  });

  it('rejects an opened directory with no config', () => {
    const dir = join(tmpRoot, 'not-a-project');
    rmSync(dir, { recursive: true, force: true });
    expect(() => fs.openProject(dir)).toThrow(ProjectError);
  });

  it('rejects an opened project with invalid JSON', () => {
    const dir = join(tmpRoot, 'project-bad');
    fs.createProject({ directory: dir, name: 'X' });
    writeFileSync(join(dir, PROJECT_CONFIG_FILE), '{ this is not json');
    expect(() => fs.openProject(dir)).toThrow(ProjectError);
  });

  it('rejects an opened project with wrong schemaVersion', () => {
    const dir = join(tmpRoot, 'project-old');
    fs.createProject({ directory: dir, name: 'Y' });
    const raw = JSON.parse(readFileSync(join(dir, PROJECT_CONFIG_FILE), 'utf-8'));
    raw.schemaVersion = '0.0';
    writeFileSync(join(dir, PROJECT_CONFIG_FILE), JSON.stringify(raw));
    expect(() => fs.openProject(dir)).toThrow(ProjectError);
  });

  it('computeStatus reports zero counts on a fresh project', () => {
    const dir = join(tmpRoot, 'project-empty');
    const info = fs.createProject({ directory: dir, name: 'empty' });
    const status = fs.computeStatus(info);
    expect(status.hasOpenProject).toBe(true);
    expect(status.counts).toEqual({ standards: 0, inputs: 0, evidence: 0, jobs: 0 });
  });
});
