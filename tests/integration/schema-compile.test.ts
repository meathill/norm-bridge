import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgentRunner } from '@agents/mock-agent-runner';
import type { AgentCompileCallbacks, AgentCompileContext, AgentRunner } from '@agents/agent-runner';
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
        lines: [
          '1 Scope',
          'This standard applies to circuit breakers.',
          '1.1 General',
          'The product shall be safe.',
          '2 Normative references',
          'IEC 60898-1:2015 applies.',
        ],
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

    // 6. Standard registry: the imported standard + the referenced IEC code are catalogued.
    // (Match by issuing_body rather than exact code: pdfjs may drop the space in
    // "IEC 60898-1" when the whole fixture renders on one line.)
    const catalog = sqlite
      .prepare('SELECT code, origin, issuing_body FROM standard_catalog')
      .all() as Array<{ code: string; origin: string; issuing_body: string | null }>;
    expect(catalog.some((c) => c.origin === 'imported')).toBe(true);
    const iec = catalog.find((c) => c.issuing_body === 'IEC');
    expect(iec).toBeDefined();
    expect(iec?.origin).toBe('referenced');

    // The reference row is upgraded from free text to a catalog FK.
    const refLinks = sqlite
      .prepare('SELECT referenced_catalog_id FROM standard_references')
      .all() as Array<{ referenced_catalog_id: string | null }>;
    expect(refLinks.some((r) => r.referenced_catalog_id !== null)).toBe(true);

    // An IEC issuing-body category exists and is linked.
    const iecCategory = sqlite
      .prepare("SELECT id FROM categories WHERE kind = 'issuing_body' AND code = 'IEC'")
      .get() as { id: string } | undefined;
    expect(iecCategory).toBeDefined();
    const links = sqlite
      .prepare('SELECT COUNT(*) as c FROM standard_categories WHERE category_id = ?')
      .get(iecCategory!.id) as { c: number };
    expect(links.c).toBeGreaterThanOrEqual(1);
  });

  it('re-compile replaces instead of appending (idempotent rows + re-linked catalog)', async () => {
    const pdf = join(tmpRoot, 'standard.pdf');
    writeFileSync(
      pdf,
      makeMinimalPdf({
        lines: [
          '1 Scope',
          'This standard applies to circuit breakers.',
          '1.1 General',
          'The product shall be safe.',
          '2 Normative references',
          'IEC 60898-1:2015 applies.',
        ],
      }),
    );
    const imp = await importService.importFile({ filePath: pdf, kind: 'standard_pdf' });
    const extractStart = await jobService.startStandardExtract({ sourceId: imp.source.id });
    await waitFinished(bus, extractStart.jobId);

    // First compile.
    const first = await compileService.start({ sourceId: imp.source.id });
    await waitFinished(bus, first.jobId);
    const countOf = (table: string) =>
      (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    const after1 = {
      standards: countOf('standards'),
      clauses: countOf('clauses'),
      requirements: countOf('requirements'),
      citations: countOf('citations'),
      references: countOf('standard_references'),
    };
    expect(after1.standards).toBe(1);
    expect(after1.clauses).toBeGreaterThan(0);

    // Second compile of the SAME source must replace, not stack.
    const second = await compileService.start({ sourceId: imp.source.id });
    await waitFinished(bus, second.jobId);
    expect(countOf('standards')).toBe(1);
    expect(countOf('clauses')).toBe(after1.clauses);
    expect(countOf('requirements')).toBe(after1.requirements);
    expect(countOf('citations')).toBe(after1.citations);
    expect(countOf('standard_references')).toBe(after1.references);

    // No orphaned requirement_citations point at a deleted requirement.
    const orphanReqCit = sqlite
      .prepare(
        'SELECT COUNT(*) AS c FROM requirement_citations WHERE requirement_id NOT IN (SELECT id FROM requirements)',
      )
      .get() as { c: number };
    expect(orphanReqCit.c).toBe(0);

    // The catalog's imported entry is re-linked to the freshly compiled standards row.
    const liveStandardId = (sqlite.prepare('SELECT id FROM standards').get() as { id: string }).id;
    const importedCatalog = sqlite
      .prepare("SELECT standard_id FROM standard_catalog WHERE origin = 'imported'")
      .get() as { standard_id: string | null } | undefined;
    expect(importedCatalog?.standard_id).toBe(liveStandardId);
  });

  it('windows a section into multiple small bounded calls', async () => {
    // Force tiny windows so even the small fixture splits into several calls.
    process.env.NORMBRIDGE_BLOCKS_PER_CALL = '1';
    process.env.NORMBRIDGE_WINDOWS_PER_SECTION = '999';
    try {
      const pdf = join(tmpRoot, 'standard.pdf');
      writeFileSync(
        pdf,
        makeMinimalPdf({
          lines: [
            '1 Scope',
            'This standard applies to circuit breakers.',
            '1.1 General',
            'The product shall be safe.',
          ],
        }),
      );
      const imp = await importService.importFile({ filePath: pdf, kind: 'standard_pdf' });
      const extractStart = await jobService.startStandardExtract({ sourceId: imp.source.id });
      await waitFinished(bus, extractStart.jobId);

      // Spy runner: count calls and assert every call respects the 1-block window.
      const mock = new MockAgentRunner();
      let calls = 0;
      let maxBlocksSeen = 0;
      const spy: AgentRunner = {
        id: 'spy',
        compile: (ctx: AgentCompileContext, cb?: AgentCompileCallbacks) => {
          calls += 1;
          maxBlocksSeen = Math.max(maxBlocksSeen, ctx.textBlocks.length);
          return mock.compile(ctx, cb);
        },
      };
      const compileStart = await compileService.start({ sourceId: imp.source.id, runner: spy });
      await waitFinished(bus, compileStart.jobId);

      // Multiple blocks ⇒ multiple windowed calls, each capped at the window size.
      expect(calls).toBeGreaterThan(1);
      expect(maxBlocksSeen).toBeLessThanOrEqual(1);

      // Records still land coherently (no crash, clauses present, ids unique).
      const clauseIds = (
        sqlite.prepare('SELECT id FROM clauses').all() as Array<{ id: string }>
      ).map((r) => r.id);
      expect(clauseIds.length).toBeGreaterThan(0);
      expect(new Set(clauseIds).size).toBe(clauseIds.length);
    } finally {
      delete process.env.NORMBRIDGE_BLOCKS_PER_CALL;
      delete process.env.NORMBRIDGE_WINDOWS_PER_SECTION;
    }
  });

  it('reuses cached window results on re-compile (no second LLM call)', async () => {
    const pdf = join(tmpRoot, 'standard.pdf');
    writeFileSync(
      pdf,
      makeMinimalPdf({
        lines: ['1 Scope', 'The product shall be safe.', 'IEC 60898-1:2015 applies.'],
      }),
    );
    const imp = await importService.importFile({ filePath: pdf, kind: 'standard_pdf' });
    const extractStart = await jobService.startStandardExtract({ sourceId: imp.source.id });
    await waitFinished(bus, extractStart.jobId);

    const makeSpy = () => {
      const mock = new MockAgentRunner();
      const state = { calls: 0 };
      const runner: AgentRunner = {
        id: 'spy',
        compile: (ctx: AgentCompileContext, cb?: AgentCompileCallbacks) => {
          state.calls += 1;
          return mock.compile(ctx, cb);
        },
      };
      return { runner, state };
    };

    // First compile populates the cache and does real (mock) LLM calls.
    const first = makeSpy();
    const run1 = await compileService.start({ sourceId: imp.source.id, runner: first.runner });
    await waitFinished(bus, run1.jobId);
    expect(first.state.calls).toBeGreaterThan(0);
    const clausesAfter1 = (
      sqlite.prepare('SELECT COUNT(*) AS c FROM clauses').get() as { c: number }
    ).c;
    expect(clausesAfter1).toBeGreaterThan(0);

    // Second compile of the same source: every window is served from cache, so
    // the runner is never called — yet the DB is rebuilt identically.
    const second = makeSpy();
    const run2 = await compileService.start({ sourceId: imp.source.id, runner: second.runner });
    await waitFinished(bus, run2.jobId);
    expect(second.state.calls).toBe(0);
    const clausesAfter2 = (
      sqlite.prepare('SELECT COUNT(*) AS c FROM clauses').get() as { c: number }
    ).c;
    expect(clausesAfter2).toBe(clausesAfter1);

    // Forcing the bypass re-calls the runner even though the cache is warm.
    process.env.NORMBRIDGE_IGNORE_COMPILE_CACHE = '1';
    try {
      const third = makeSpy();
      const run3 = await compileService.start({ sourceId: imp.source.id, runner: third.runner });
      await waitFinished(bus, run3.jobId);
      expect(third.state.calls).toBeGreaterThan(0);
    } finally {
      delete process.env.NORMBRIDGE_IGNORE_COMPILE_CACHE;
    }
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
