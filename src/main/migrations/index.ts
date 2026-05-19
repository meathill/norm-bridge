import { createHash } from 'node:crypto';
import migration0001 from './0001_init.sql?raw';

export type Migration = {
  version: number;
  name: string;
  sql: string;
  checksum: string;
};

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function defineMigration(version: number, name: string, sql: string): Migration {
  return { version, name, sql, checksum: checksum(sql) };
}

export const MIGRATIONS: readonly Migration[] = [
  defineMigration(1, 'init', migration0001),
] as const;
