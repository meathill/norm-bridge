import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgentRunner } from '@agents/mock-agent-runner';
import { MockSearchRunner, tokenize } from '@agents/search-runner';
import { ArtifactStore } from '@main/services/artifact-store';
import { ImportService } from '@main/services/import-service';
import { JobBus } from '@main/services/job-bus';
import { JobService } from '@main/services/job-service';
import { ProjectFs } from '@main/services/project-fs';
import { ProjectSession } from '@main/services/project-session';
import { SchemaCompileService } from '@main/services/schema-compile-service';
import { SearchService } from '@main/services/search-service';
import { SourceRegistry } from '@main/services/source-registry';
import { SqliteService } from '@main/services/sqlite-service';
import { ParserRegistry } from '@main/parsers/parser-registry';
import type { JobEvent } from '@shared/domain/job';
import { makeMinimalPdf } from '../../fixtures/make-pdf';

function waitFinished(bus: JobBus, jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = bus.on((e: JobEvent) => {
      if (e.jobId !== jobId) return;
      if (e.type === 'finished') {
        off();
        if (e.status === 'succeeded') resolve();
        else reject(new Error(`job ${e.status}: ${e.error ?? 'unknown'}`));
      }
    });
  });
}

describe('tokenize', () => {
  it('splits on whitespace and punctuation, drops stopwords', () => {
    expect(tokenize('1A miniature circuit breaker for residential use')).toEqual([
      '1a',
      'miniature',
      'circuit',
      'breaker',
      'residential',
      'use',
    ]);
  });

  it('handles Chinese commas and stopwords', () => {
    expect(tokenize('请告诉我 1A 漏电 断路器')).toEqual(['1a', '漏电', '断路器']);
  });
});

describe('SearchService (mock runner + LIKE retriever)', () => {
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
  let searchService: SearchService;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'nb-search-'));
    projectDir = join(tmpRoot, 'project');
    const fs = new ProjectFs();
    sqlite = new SqliteService();
    session = new ProjectSession(fs, sqlite);
    session.create({ directory: projectDir, name: 'search-test' });
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
    searchService = new SearchService(session, sqlite, new MockSearchRunner());

    // Seed: import → extract → compile a PDF that contains "shall" requirements.
    const pdf = join(tmpRoot, 'standard.pdf');
    writeFileSync(
      pdf,
      makeMinimalPdf({
        lines: [
          '4.1 Insulation',
          'The miniature circuit breaker shall withstand 1500V for 1 minute.',
          '4.2 Tripping',
          'The breaker shall trip within 60ms at 1A nominal current.',
          '4.3 Marking',
          'The product shall be marked with rated current and voltage.',
        ],
      }),
    );
    const imp = await importService.importFile({ filePath: pdf, kind: 'standard_pdf' });
    const e1 = await jobService.startStandardExtract({ sourceId: imp.source.id });
    await waitFinished(bus, e1.jobId);
    const c1 = await compileService.start({ sourceId: imp.source.id });
    await waitFinished(bus, c1.jobId);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns ranked cards for a free-text product query', async () => {
    const result = await searchService.query({ text: 'miniature circuit breaker 1A' });
    expect(result.expanderId).toBe('mock');
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards[0]?.score).toBeGreaterThanOrEqual(1);
    // The PDF includes "1A" — make sure that requirement ranks high.
    const top = result.cards[0];
    expect(top?.requirementText.toLowerCase()).toContain('shall');
  });

  it('returns no cards when no token matches', async () => {
    const result = await searchService.query({ text: 'xyz unrelated' });
    expect(result.cards).toHaveLength(0);
  });

  it('respects the limit option', async () => {
    const result = await searchService.query({ text: 'breaker shall', limit: 2 });
    expect(result.cards.length).toBeLessThanOrEqual(2);
  });

  it('refuses when no project is open', async () => {
    sqlite.close();
    const fresh = new ProjectSession(new ProjectFs(), new SqliteService());
    const svc = new SearchService(fresh, new SqliteService(), new MockSearchRunner());
    await expect(svc.query({ text: 'anything' })).rejects.toThrow(/No project/);
  });
});
