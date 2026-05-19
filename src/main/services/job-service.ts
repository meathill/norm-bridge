import { newId } from '@shared/ids';
import type { JobInfo, JobKind, StartJobResult } from '@shared/domain/job';
import type { SourceFile } from '@shared/domain/source';
import type { ParserRegistry } from '@main/parsers/parser-registry';
import type { PdfParser } from '@main/parsers/pdf/pdf-parser';
import type { ArtifactStore } from './artifact-store';
import type { JobBus, JobHandle } from './job-bus';
import type { ProjectSession } from './project-session';
import type { SourceRegistry } from './source-registry';
import type { SqliteService } from './sqlite-service';

export type StartStandardExtractInput = {
  sourceId: string;
};

export class JobService {
  constructor(
    private readonly session: ProjectSession,
    private readonly sources: SourceRegistry,
    private readonly parsers: ParserRegistry,
    private readonly artifacts: ArtifactStore,
    private readonly bus: JobBus,
    private readonly sqlite: SqliteService,
  ) {}

  getJob(jobId: string): JobInfo | null {
    return this.bus.getJob(jobId);
  }

  listJobs(filter?: { kind?: JobKind; sourceId?: string }): JobInfo[] {
    return this.bus.listJobs(filter);
  }

  async startStandardExtract({ sourceId }: StartStandardExtractInput): Promise<StartJobResult> {
    const project = this.session.getCurrent();
    if (!project) {
      throw new Error('No project is open. Open or create a project first.');
    }
    const source = this.sources.getById(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }
    if (source.kind !== 'standard_pdf') {
      throw new Error(`Source ${sourceId} is not a standard_pdf (kind=${source.kind}).`);
    }

    const handle = await this.bus.create({
      kind: 'standard_extract',
      sourceId,
      planPayload: {
        kind: 'standard_extract',
        sourceId,
        originalName: source.originalName,
        sha256: source.sha256,
      },
    });

    this.writeAudit('standard_index_job_started', 'job', handle.id, {
      sourceId,
      kind: source.kind,
    });

    // Fire-and-forget; status is observed via job events.
    void this.runStandardExtract(handle, source).catch(async (err) => {
      await handle.finishFailure(err as Error);
    });

    return { jobId: handle.id };
  }

  private async runStandardExtract(handle: JobHandle, source: SourceFile): Promise<void> {
    const project = this.session.getCurrent();
    if (!project) {
      throw new Error('Project closed during job execution.');
    }

    const pdfParser = this.parsers.requirePdf() as PdfParser;
    const absPath = this.sources.resolveAbsolutePath({ directory: project.directory }, source);

    try {
      const data = await pdfParser.extract({
        filePath: absPath,
        sourceId: source.id,
        onProgress: ({ page, totalPages }) => {
          // Reserve the last 5% for artifact writes so the bar doesn't snap to 100% prematurely.
          const ratio = (page / totalPages) * 0.95;
          void handle.emitProgress(ratio, `Page ${page}/${totalPages}`);
        },
      });

      const sourceMeta = await this.artifacts.writeJson(
        project,
        { scope: 'standards', ownerId: source.id, name: 'source-metadata.json' },
        {
          sourceId: source.id,
          originalName: source.originalName,
          sha256: source.sha256,
          extractedAt: new Date().toISOString(),
          pdfPageCount: data.pages.length,
          totalTextBlocks: data.textBlocks.length,
        },
      );
      await handle.emitArtifactWritten(sourceMeta.relativePath);

      const pagesRef = await this.artifacts.writeJson(
        project,
        { scope: 'standards', ownerId: source.id, name: 'pages.json' },
        data.pages,
      );
      await handle.emitArtifactWritten(pagesRef.relativePath);

      const blocksRef = await this.artifacts.writeJson(
        project,
        { scope: 'standards', ownerId: source.id, name: 'text-blocks.json' },
        data.textBlocks,
      );
      await handle.emitArtifactWritten(blocksRef.relativePath);

      await handle.emitProgress(1, 'done');
      await handle.finishSuccess();

      this.writeAudit('document_extracted', 'source', source.id, {
        jobId: handle.id,
        pageCount: data.pages.length,
        textBlockCount: data.textBlocks.length,
      });
    } catch (err) {
      await handle.finishFailure(err as Error);
      this.writeAudit('document_extract_failed', 'source', source.id, {
        jobId: handle.id,
        error: (err as Error).message,
      });
    }
  }

  private writeAudit(
    eventType: string,
    targetType: 'job' | 'source',
    targetId: string,
    payload: unknown,
  ): void {
    this.sqlite
      .prepare(
        'INSERT INTO audit_events (id, event_type, actor, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId('auditEvent'),
        eventType,
        'system',
        targetType,
        targetId,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
  }
}
