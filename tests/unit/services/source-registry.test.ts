import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectFs } from '@main/services/project-fs';
import { SqliteService } from '@main/services/sqlite-service';
import { SourceRegistry } from '@main/services/source-registry';

describe('SourceRegistry', () => {
  let tmpRoot: string;
  let fs: ProjectFs;
  let sqlite: SqliteService;
  let registry: SourceRegistry;
  let projectDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-srcreg-'));
    fs = new ProjectFs();
    sqlite = new SqliteService();
    registry = new SourceRegistry(fs, sqlite);
    projectDir = join(tmpRoot, 'project');
    const info = fs.createProject({ directory: projectDir, name: 'T' });
    sqlite.open(fs.resolveDbPath(info));
    sqlite.runMigrations();
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('copies file into sources/standards/ and writes a row', async () => {
    const filePath = join(tmpRoot, 'std.pdf');
    writeFileSync(filePath, 'hello pdf content');

    const result = await registry.register(
      { directory: projectDir },
      {
        filePath,
        kind: 'standard_pdf',
      },
    );

    expect(result.alreadyExisted).toBe(false);
    expect(result.source.relativePath).toMatch(/^sources\/standards\//);
    expect(result.source.sha256).toHaveLength(64);
    expect(result.source.originalName).toBe('std.pdf');
    expect(result.source.mimeType).toBe('application/pdf');

    const absCopy = registry.resolveAbsolutePath({ directory: projectDir }, result.source);
    expect(statSync(absCopy).isFile()).toBe(true);

    const row = sqlite.prepare('SELECT id, kind, sha256 FROM sources').get() as {
      id: string;
      kind: string;
      sha256: string;
    };
    expect(row.id).toBe(result.source.id);
    expect(row.kind).toBe('standard_pdf');
  });

  it('is idempotent on identical file (same sha256 → reuse row, no duplicate copy)', async () => {
    const filePath = join(tmpRoot, 'std.pdf');
    writeFileSync(filePath, 'idempotent content');

    const first = await registry.register(
      { directory: projectDir },
      {
        filePath,
        kind: 'standard_pdf',
      },
    );
    const second = await registry.register(
      { directory: projectDir },
      {
        filePath,
        kind: 'standard_pdf',
      },
    );

    expect(second.alreadyExisted).toBe(true);
    expect(second.source.id).toBe(first.source.id);
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM sources').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('different content → different rows', async () => {
    const a = join(tmpRoot, 'a.pdf');
    const b = join(tmpRoot, 'b.pdf');
    writeFileSync(a, 'one');
    writeFileSync(b, 'two');

    const ra = await registry.register(
      { directory: projectDir },
      { filePath: a, kind: 'standard_pdf' },
    );
    const rb = await registry.register(
      { directory: projectDir },
      { filePath: b, kind: 'standard_pdf' },
    );

    expect(ra.source.sha256).not.toBe(rb.source.sha256);
    expect(ra.source.id).not.toBe(rb.source.id);
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM sources').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('routes excel_input to sources/inputs/', async () => {
    const filePath = join(tmpRoot, 'quote.xlsx');
    writeFileSync(filePath, 'xlsx');
    const r = await registry.register({ directory: projectDir }, { filePath, kind: 'excel_input' });
    expect(r.source.relativePath).toMatch(/^sources\/inputs\//);
  });

  it('throws on non-file path', async () => {
    await expect(
      registry.register({ directory: projectDir }, { filePath: tmpRoot, kind: 'standard_pdf' }),
    ).rejects.toThrow(/Not a file/);
  });

  it('getById returns the stored row', async () => {
    const filePath = join(tmpRoot, 'x.pdf');
    writeFileSync(filePath, 'x');
    const r = await registry.register(
      { directory: projectDir },
      { filePath, kind: 'standard_pdf' },
    );
    const fetched = registry.getById(r.source.id);
    expect(fetched?.sha256).toBe(r.source.sha256);
  });
});
