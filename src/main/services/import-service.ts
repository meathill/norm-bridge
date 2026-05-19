import type { ImportResult } from '@shared/domain/import-result';
import type { SourceKind } from '@shared/domain/source';
import { newId } from '@shared/ids';
import type { ParserRegistry } from '@main/parsers/parser-registry';
import type { ProjectSession } from './project-session';
import type { SourceRegistry } from './source-registry';
import type { SqliteService } from './sqlite-service';

export type ImportInput = {
  filePath: string;
  kind: SourceKind;
};

export class ImportService {
  constructor(
    private readonly session: ProjectSession,
    private readonly sources: SourceRegistry,
    private readonly parsers: ParserRegistry,
    private readonly sqlite: SqliteService,
  ) {}

  async importFile(input: ImportInput): Promise<ImportResult> {
    const project = this.session.getCurrent();
    if (!project) {
      throw new Error('No project is open. Open or create a project first.');
    }

    const parser = this.parsers.resolve(input.filePath);
    if (!parser) {
      throw new Error(`No parser registered for ${input.filePath}`);
    }

    const { source, alreadyExisted } = await this.sources.register(
      { directory: project.directory },
      { filePath: input.filePath, kind: input.kind },
    );

    const absPath = this.sources.resolveAbsolutePath({ directory: project.directory }, source);
    const inspection = await parser.inspect({ filePath: absPath });

    this.writeAudit('document_imported', source.id, {
      kind: input.kind,
      sha256: source.sha256,
      alreadyExisted,
      inspection: {
        documentKind: inspection.documentKind,
        pageCount: inspection.pageCount,
        isEncrypted: inspection.isEncrypted,
        hasTextLayer: inspection.hasTextLayer,
        needsOcr: inspection.needsOcr,
      },
    });

    return { source, inspection, alreadyExisted };
  }

  private writeAudit(eventType: string, sourceId: string, payload: unknown): void {
    this.sqlite
      .prepare(
        'INSERT INTO audit_events (id, event_type, actor, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId('auditEvent'),
        eventType,
        'system',
        'source',
        sourceId,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
  }
}
