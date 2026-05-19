import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteService, MigrationChecksumMismatchError } from '@main/services/sqlite-service';
import { MIGRATIONS } from '@main/migrations';

describe('SqliteService', () => {
  let tmpDir: string;
  let svc: SqliteService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nb-sqlite-test-'));
    svc = new SqliteService();
  });

  afterEach(() => {
    svc.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens and creates the db file with foreign_keys ON', () => {
    const dbPath = join(tmpDir, 'db', 'test.sqlite');
    svc.open(dbPath);
    expect(svc.isOpen()).toBe(true);
    const fk = svc.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });

  it('applies all migrations on first run and is idempotent', () => {
    const dbPath = join(tmpDir, 'db', 'mig.sqlite');
    svc.open(dbPath);

    const first = svc.runMigrations();
    expect(first.appliedVersions).toEqual(MIGRATIONS.map((m) => m.version));
    expect(first.alreadyApplied).toEqual([]);

    const second = svc.runMigrations();
    expect(second.appliedVersions).toEqual([]);
    expect(second.alreadyApplied).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('creates the full TECH_SPEC §11.1 table set', () => {
    svc.open(join(tmpDir, 'db', 'full.sqlite'));
    svc.runMigrations();
    const rows = svc
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const expected of [
      'audit_events',
      'citations',
      'clauses',
      'evidence_citations',
      'evidence_items',
      'match_citations',
      'match_results',
      'product_attributes',
      'products',
      'requirement_citations',
      'requirements',
      'schema_migrations',
      'sources',
      'standard_references',
      'standards',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('rejects a migration with a different checksum than what was applied', () => {
    svc.open(join(tmpDir, 'db', 'checksum.sqlite'));
    svc.runMigrations();

    expect(() =>
      svc.runMigrations([
        { version: 1, name: 'init', sql: 'CREATE TABLE x (id INTEGER)', checksum: 'tampered' },
      ]),
    ).toThrow(MigrationChecksumMismatchError);
  });

  it('rolls back a failing migration', () => {
    svc.open(join(tmpDir, 'db', 'rollback.sqlite'));

    expect(() =>
      svc.runMigrations([
        {
          version: 1,
          name: 'broken',
          sql: 'CREATE TABLE ok (id INTEGER); CREATE TABLE oops invalid sql here;',
          checksum: 'whatever',
        },
      ]),
    ).toThrow();

    const tables = svc
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'")
      .all();
    expect(tables).toEqual([]);
    const applied = svc.prepare('SELECT version FROM schema_migrations').all();
    expect(applied).toEqual([]);
  });

  it('wraps tx with rollback on throw', () => {
    svc.open(join(tmpDir, 'db', 'tx.sqlite'));
    svc.runMigrations();

    expect(() =>
      svc.tx(() => {
        svc
          .prepare(
            "INSERT INTO sources (id, kind, original_name, relative_path, sha256, size_bytes, imported_at) VALUES (?, 'standard_pdf', 'a.pdf', 'sources/a.pdf', 'hash', 1, ?)",
          )
          .run('src_1', new Date().toISOString());
        throw new Error('forced');
      }),
    ).toThrow('forced');

    const count = svc.prepare('SELECT COUNT(*) as c FROM sources').get() as { c: number };
    expect(count.c).toBe(0);
  });
});
