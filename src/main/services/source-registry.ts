import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { newId } from '@shared/ids';
import type { SourceFile, SourceKind } from '@shared/domain/source';
import type { ProjectFs } from './project-fs';
import type { SqliteService } from './sqlite-service';

/**
 * Maps a source kind to the directory under `sources/` where the file is stored.
 * Falls back to a kind-named directory if not explicitly listed.
 */
const KIND_BUCKETS: Partial<Record<SourceKind, string>> = {
  standard_pdf: 'standards',
  excel_input: 'inputs',
  certificate: 'evidence/certificates',
  test_report: 'evidence/test-reports',
  product_spec: 'evidence/product-specs',
  datasheet: 'evidence/product-specs',
  report_template: 'inputs',
};

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export type RegisterInput = {
  filePath: string;
  kind: SourceKind;
};

export type RegisterResult = {
  source: SourceFile;
  alreadyExisted: boolean;
};

export class SourceRegistry {
  constructor(
    private readonly fs: ProjectFs,
    private readonly sqlite: SqliteService,
  ) {}

  async register(project: { directory: string }, input: RegisterInput): Promise<RegisterResult> {
    const absSource = resolve(input.filePath);
    const stats = await stat(absSource);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${absSource}`);
    }

    const sha256 = await hashFile(absSource);
    const originalName = basename(absSource);

    const existing = this.sqlite.prepare('SELECT * FROM sources WHERE sha256 = ?').get(sha256) as
      | {
          id: string;
          kind: string;
          original_name: string;
          relative_path: string;
          sha256: string;
          size_bytes: number;
          imported_at: string;
          mime_type: string | null;
        }
      | undefined;

    if (existing) {
      return {
        source: rowToSource(existing),
        alreadyExisted: true,
      };
    }

    const bucket = KIND_BUCKETS[input.kind] ?? input.kind;
    const destDir = resolve(project.directory, 'sources', bucket);
    await mkdir(destDir, { recursive: true });

    const destName = sanitizeBucketName(sha256, originalName);
    const absDest = resolve(destDir, destName);
    await copyFile(absSource, absDest);

    const relativePath = toPosix(relative(project.directory, absDest));
    const ext = originalName.toLowerCase().slice(originalName.lastIndexOf('.'));
    const mimeType = MIME_BY_EXT[ext];

    const source: SourceFile = {
      id: newId('source'),
      kind: input.kind,
      originalName,
      relativePath,
      sha256,
      sizeBytes: stats.size,
      importedAt: new Date().toISOString(),
      ...(mimeType ? { mimeType } : {}),
    };

    this.sqlite
      .prepare(
        `INSERT INTO sources (id, kind, original_name, relative_path, sha256, size_bytes, imported_at, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        source.id,
        source.kind,
        source.originalName,
        source.relativePath,
        source.sha256,
        source.sizeBytes,
        source.importedAt,
        source.mimeType ?? null,
      );

    return { source, alreadyExisted: false };
  }

  getById(id: string): SourceFile | null {
    const row = this.sqlite.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      | Parameters<typeof rowToSource>[0]
      | undefined;
    return row ? rowToSource(row) : null;
  }

  list(kind?: SourceKind): SourceFile[] {
    const stmt = kind
      ? this.sqlite.prepare('SELECT * FROM sources WHERE kind = ? ORDER BY imported_at DESC')
      : this.sqlite.prepare('SELECT * FROM sources ORDER BY imported_at DESC');
    const rows = (kind ? stmt.all(kind) : stmt.all()) as Array<Parameters<typeof rowToSource>[0]>;
    return rows.map(rowToSource);
  }

  resolveAbsolutePath(project: { directory: string }, source: SourceFile): string {
    return resolve(project.directory, source.relativePath);
  }
}

function rowToSource(row: {
  id: string;
  kind: string;
  original_name: string;
  relative_path: string;
  sha256: string;
  size_bytes: number;
  imported_at: string;
  mime_type: string | null;
}): SourceFile {
  return {
    id: row.id,
    kind: row.kind as SourceKind,
    originalName: row.original_name,
    relativePath: row.relative_path,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    importedAt: row.imported_at,
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
  };
}

async function hashFile(absPath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(absPath), hash);
  return hash.digest('hex');
}

function sanitizeBucketName(sha256: string, originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `${sha256.slice(0, 12)}-${safe}`;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
