import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@main/services/artifact-store';
import { ImportService } from '@main/services/import-service';
import { JobBus } from '@main/services/job-bus';
import { JobService } from '@main/services/job-service';
import { ProjectFs } from '@main/services/project-fs';
import { ProjectSession } from '@main/services/project-session';
import { SourceRegistry } from '@main/services/source-registry';
import { SqliteService } from '@main/services/sqlite-service';
import { ParserRegistry } from '@main/parsers/parser-registry';
import type { JobEvent } from '@shared/domain/job';
import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import { makeMinimalPdf } from '../fixtures/make-pdf';

async function waitForFinished(bus: JobBus, jobId: string): Promise<JobEvent[]> {
  return new Promise((resolve) => {
    const collected: JobEvent[] = [];
    const off = bus.on((e) => {
      if (e.jobId !== jobId) return;
      collected.push(e);
      if (e.type === 'finished') {
        off();
        resolve(collected);
      }
    });
  });
}

describe('Standard extract job (PDF → artifacts → SQLite)', () => {
  let tmpRoot: string;
  let projectDir: string;
  let fs: ProjectFs;
  let sqlite: SqliteService;
  let session: ProjectSession;
  let sources: SourceRegistry;
  let parsers: ParserRegistry;
  let artifacts: ArtifactStore;
  let bus: JobBus;
  let jobs: JobService;
  let imports: ImportService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-extract-int-'));
    projectDir = join(tmpRoot, 'project');
    fs = new ProjectFs();
    sqlite = new SqliteService();
    session = new ProjectSession(fs, sqlite);
    session.create({ directory: projectDir, name: 'integration' });
    sources = new SourceRegistry(fs, sqlite);
    parsers = new ParserRegistry();
    artifacts = new ArtifactStore();
    bus = new JobBus(session, artifacts);
    imports = new ImportService(session, sources, parsers, sqlite);
    jobs = new JobService(session, sources, parsers, artifacts, bus, sqlite);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('imports a PDF and produces pages.json / text-blocks.json / source-metadata.json', async () => {
    const tmpPdf = join(tmpRoot, 'src.pdf');
    writeFileSync(tmpPdf, makeMinimalPdf({ text: 'Integration extract' }));

    const imp = await imports.importFile({ filePath: tmpPdf, kind: 'standard_pdf' });
    expect(imp.inspection.documentKind).toBe('pdf');

    const finishedPromise = (async () => {
      const start = await jobs.startStandardExtract({ sourceId: imp.source.id });
      const events = await waitForFinished(bus, start.jobId);
      return events;
    })();

    const events = await finishedPromise;
    const final = events.find((e) => e.type === 'finished');
    expect(final && 'status' in final && final.status).toBe('succeeded');

    const sourceArtifactDir = join(projectDir, 'artifacts', 'standards', imp.source.id);
    const meta = JSON.parse(readFileSync(join(sourceArtifactDir, 'source-metadata.json'), 'utf-8'));
    expect(meta.pdfPageCount).toBe(1);
    expect(meta.totalTextBlocks).toBeGreaterThan(0);

    const pages: PdfPageInfo[] = JSON.parse(
      readFileSync(join(sourceArtifactDir, 'pages.json'), 'utf-8'),
    );
    expect(pages).toHaveLength(1);

    const blocks: PdfTextBlock[] = JSON.parse(
      readFileSync(join(sourceArtifactDir, 'text-blocks.json'), 'utf-8'),
    );
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.text).toContain('Integration');

    // events.jsonl should be present and contain a finished entry.
    const jobsDir = join(projectDir, 'artifacts', 'jobs');
    const jobInfo = jobs.getJob(events[0]?.jobId ?? '');
    expect(jobInfo?.status).toBe('succeeded');
    expect(jobInfo?.artifactPaths.length).toBeGreaterThanOrEqual(3);

    const eventsContent = readFileSync(join(jobsDir, jobInfo!.id, 'events.jsonl'), 'utf-8');
    expect(eventsContent).toContain('"type":"finished"');
  });

  it('rejects starting an extract for an excel input', async () => {
    const tmpXlsx = join(tmpRoot, 'list.xlsx');
    writeFileSync(tmpXlsx, 'not really xlsx');
    // Bypass the parser inspection (which would fail on a non-PDF) by registering
    // the source directly — we only want to verify the kind guard.
    const reg = await sources.register(
      { directory: projectDir },
      { filePath: tmpXlsx, kind: 'excel_input' },
    );
    await expect(jobs.startStandardExtract({ sourceId: reg.source.id })).rejects.toThrow(
      /not a standard_pdf/,
    );
  });
});
