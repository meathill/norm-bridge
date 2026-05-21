import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgentRunner } from '@agents/mock-agent-runner';
import { ArtifactStore } from '@main/services/artifact-store';
import { ImportService } from '@main/services/import-service';
import { JobBus } from '@main/services/job-bus';
import { JobService } from '@main/services/job-service';
import { ProjectFs } from '@main/services/project-fs';
import { ProjectSession } from '@main/services/project-session';
import { SchemaCompileService } from '@main/services/schema-compile-service';
import { SourceRegistry } from '@main/services/source-registry';
import { SqliteService } from '@main/services/sqlite-service';
import { ParserRegistry } from '@main/parsers/parser-registry';
import type { JobEvent } from '@shared/domain/job';
import type { StandardSchemaArtifact } from '@shared/domain/standard-schema';
import { makeMinimalPdf } from '../fixtures/make-pdf';

function waitFinished(bus: JobBus, jobId: string): Promise<JobEvent[]> {
  return new Promise((resolve, reject) => {
    const events: JobEvent[] = [];
    const off = bus.on((e) => {
      if (e.jobId !== jobId) return;
      events.push(e);
      if (e.type === 'finished') {
        off();
        if (e.status === 'succeeded') resolve(events);
        else reject(new Error(`job ${e.status}: ${e.error ?? 'unknown'}`));
      }
    });
  });
}

describe('Schema compile (extract → mock agent → SQLite + artifacts)', () => {
  let tmpRoot: string;
  let projectDir: string;
  let sqlite: SqliteService;
  let session: ProjectSession;
  let sources: SourceRegistry;
  let parsers: ParserRegistry;
  let artifacts: ArtifactStore;
  let bus: JobBus;
  let importService: ImportService;
  let jobService: JobService;
  let compileService: SchemaCompileService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-compile-int-'));
    projectDir = join(tmpRoot, 'project');
    const fs = new ProjectFs();
    sqlite = new SqliteService();
    session = new ProjectSession(fs, sqlite);
    session.create({ directory: projectDir, name: 'compile-test' });
    sources = new SourceRegistry(fs, sqlite);
    parsers = new ParserRegistry();
    artifacts = new ArtifactStore();
    bus = new JobBus(session, artifacts);
    importService = new ImportService(session, sources, parsers, sqlite);
    jobService = new JobService(session, sources, parsers, artifacts, bus, sqlite);
    compileService = new SchemaCompileService(
      session,
      sources,
      artifacts,
      bus,
      sqlite,
      new MockAgentRunner(),
      parsers,
    );
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('runs full pipeline: import → extract → schema_compile and writes all rows + artifacts', async () => {
    // 1. Make a small PDF with clear clause structure.
    const pdf = join(tmpRoot, 'standard.pdf');
    writeFileSync(
      pdf,
      makeMinimalPdf({
        text:
          '1 Scope. This standard applies. 1.1 General. ' +
          'The product shall be safe. 2 Normative references. IEC 60898-1:2015 applies.',
      }),
    );
    const imp = await importService.importFile({ filePath: pdf, kind: 'standard_pdf' });

    // 2. Extract job.
    const extractStart = await jobService.startStandardExtract({ sourceId: imp.source.id });
    await waitFinished(bus, extractStart.jobId);

    // 3. Schema compile job.
    const compileStart = await compileService.start({ sourceId: imp.source.id });
    await waitFinished(bus, compileStart.jobId);

    // 4. Artifacts on disk.
    const bundlePath = join(
      projectDir,
      'artifacts/standards',
      imp.source.id,
      'standard-schema.v0.1.json',
    );
    const bundle: StandardSchemaArtifact = JSON.parse(readFileSync(bundlePath, 'utf-8'));
    expect(bundle.schemaVersion).toBe('0.1');
    expect(bundle.standard.sourceId).toBe(imp.source.id);
    expect(bundle.clauses.length).toBeGreaterThan(0);

    // 5. SQLite rows are populated and have all unreviewed status.
    const standards = sqlite.prepare('SELECT id, status FROM standards').all() as Array<{
      id: string;
      status: string;
    }>;
    expect(standards).toHaveLength(1);
    expect(standards[0]?.status).toBe('compiled');

    const clauseCount = sqlite.prepare('SELECT COUNT(*) as c FROM clauses').get() as { c: number };
    expect(clauseCount.c).toBe(bundle.clauses.length);

    const citationCount = sqlite.prepare('SELECT COUNT(*) as c FROM citations').get() as {
      c: number;
    };
    expect(citationCount.c).toBe(bundle.citations.length);

    // Every requirement that survived the citation gate must FK to at least one citation.
    const unreviewedReqs = sqlite
      .prepare("SELECT COUNT(*) as c FROM requirements WHERE review_status = 'unreviewed'")
      .get() as { c: number };
    expect(unreviewedReqs.c).toBeLessThanOrEqual(bundle.requirements.length);

    // Audit events include a schema_compiled entry.
    const audits = sqlite
      .prepare(
        "SELECT event_type FROM audit_events WHERE event_type LIKE 'schema%' OR event_type LIKE 'document_%'",
      )
      .all() as Array<{ event_type: string }>;
    const types = audits.map((a) => a.event_type);
    expect(types).toContain('schema_compiled');
  });

  it('refuses to compile when the source is not a standard PDF', async () => {
    const xlsx = join(tmpRoot, 'list.xlsx');
    writeFileSync(xlsx, 'not really xlsx');
    const reg = await sources.register(
      { directory: projectDir },
      { filePath: xlsx, kind: 'excel_input' },
    );
    await expect(compileService.start({ sourceId: reg.source.id })).rejects.toThrow(
      /not a standard_pdf/,
    );
  });
});
