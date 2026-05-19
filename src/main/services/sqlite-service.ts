import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS, type Migration } from '@main/migrations';

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export type MigrationResult = {
  appliedVersions: number[];
  alreadyApplied: number[];
  totalMigrations: number;
};

export class MigrationChecksumMismatchError extends Error {
  constructor(
    public readonly version: number,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `migration v${version} checksum mismatch: stored ${actual} vs source ${expected}. ` +
        `Refusing to run to protect existing data.`,
    );
    this.name = 'MigrationChecksumMismatchError';
  }
}

export class SqliteService {
  private db: DatabaseSync | null = null;
  private dbPath: string | null = null;

  open(dbPath: string): void {
    if (this.db) {
      throw new Error(`SqliteService already open at ${this.dbPath}`);
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.dbPath = dbPath;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPath = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('SqliteService is not open. Call open(dbPath) first.');
    }
    return this.db;
  }

  prepare(sql: string): StatementSync {
    return this.requireDb().prepare(sql);
  }

  exec(sql: string): void {
    this.requireDb().exec(sql);
  }

  tx<T>(fn: (db: DatabaseSync) => T): T {
    const db = this.requireDb();
    db.exec('BEGIN');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  runMigrations(migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
    const db = this.requireDb();
    db.exec(SCHEMA_MIGRATIONS_DDL);

    const existing = new Map<number, { name: string; checksum: string }>();
    for (const row of db
      .prepare('SELECT version, name, checksum FROM schema_migrations')
      .all() as Array<{ version: number; name: string; checksum: string }>) {
      existing.set(row.version, { name: row.name, checksum: row.checksum });
    }

    const insert = db.prepare(
      'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    );

    const appliedVersions: number[] = [];
    const alreadyApplied: number[] = [];

    for (const m of migrations) {
      const stored = existing.get(m.version);
      if (stored) {
        if (stored.checksum !== m.checksum) {
          throw new MigrationChecksumMismatchError(m.version, m.checksum, stored.checksum);
        }
        alreadyApplied.push(m.version);
        continue;
      }
      db.exec('BEGIN');
      try {
        db.exec(m.sql);
        insert.run(m.version, m.name, m.checksum, new Date().toISOString());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      appliedVersions.push(m.version);
    }

    return {
      appliedVersions,
      alreadyApplied,
      totalMigrations: migrations.length,
    };
  }
}
