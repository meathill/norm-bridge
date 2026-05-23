import {
  STANDARD_SCHEMA_VERSION,
  type CitationRecord,
  type ClauseRecord,
  type RequirementRecord,
  type StandardRecord,
  type StandardReferenceRecord,
  type StandardSchemaArtifact,
} from '@shared/domain/standard-schema';
import type {
  CitationAnchor,
  ClauseCompilerOutput,
  ReferenceResolverOutput,
  RequirementExtractorOutput,
} from '@shared/schemas/agent-outputs';
import {
  clauseCompilerOutputSchema,
  referenceResolverOutputSchema,
  requirementExtractorOutputSchema,
} from '@shared/schemas/agent-outputs';
import { standardSchemaArtifactSchema } from '@shared/schemas/standard-schema.v0.1';
import type { AgentRunner } from '@agents/agent-runner';
import { newId } from '@shared/ids';
import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import type { SectionEntry, SectionMap } from '@shared/domain/section';
import type { SourceFile } from '@shared/domain/source';
import type { ParserRegistry } from '@main/parsers/parser-registry';
import type { PdfParser } from '@main/parsers/pdf/pdf-parser';
import type { ArtifactStore } from './artifact-store';
import { CatalogService } from './catalog-service';
import type { JobBus, JobHandle } from './job-bus';
import type { ProjectSession } from './project-session';
import type { SourceRegistry } from './source-registry';
import type { SqliteService } from './sqlite-service';

export type StartSchemaCompileInput = {
  sourceId: string;
  /** If absent, falls back to the runner the service was constructed with. */
  runner?: AgentRunner;
};

function envPositiveInt(name: string, fallback: number): number {
  const n = Number.parseInt((process.env[name] ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** How many sections to process per compile run while we validate the approach. */
function maxSections(): number {
  return envPositiveInt('NORMBRIDGE_MAX_SECTIONS', 5);
}

/**
 * Blocks per LLM call. The model emits ~one requirement per modal verb, so the
 * RESPONSE size scales with how many "shall/must" sentences a window contains —
 * not with input length. Small windows keep each response well under the request
 * timeout. Default 200 ≈ ~20 requirements/window on a dense spec.
 */
function blocksPerCall(): number {
  return envPositiveInt('NORMBRIDGE_BLOCKS_PER_CALL', 200);
}

/** Cap windows per section so a giant section can't explode into 100s of calls. */
function windowsPerSection(): number {
  return envPositiveInt('NORMBRIDGE_WINDOWS_PER_SECTION', 4);
}

function chunkBlocks(blocks: PdfTextBlock[], size: number): PdfTextBlock[][] {
  if (size <= 0) return [blocks];
  const out: PdfTextBlock[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}

function pagesForBlocks(pages: PdfPageInfo[], blocks: PdfTextBlock[]): PdfPageInfo[] {
  const present = new Set(blocks.map((b) => b.page));
  return pages.filter((p) => present.has(p.page));
}

type BuiltSchema = {
  standard: StandardRecord;
  clauses: ClauseRecord[];
  requirements: RequirementRecord[];
  references: StandardReferenceRecord[];
  citations: CitationRecord[];
  compiledAt: string;
  sectionsProcessed: number;
  sectionsTotal: number;
  refs: {
    clauses: string;
    requirements: string;
    citations: string;
    references: string;
    bundle: string;
    sections: string;
  };
};

export class SchemaCompileService {
  private readonly catalog: CatalogService;

  constructor(
    private readonly session: ProjectSession,
    private readonly sources: SourceRegistry,
    private readonly artifacts: ArtifactStore,
    private readonly bus: JobBus,
    private readonly sqlite: SqliteService,
    private readonly defaultRunner: AgentRunner,
    private readonly parsers: ParserRegistry,
  ) {
    this.catalog = new CatalogService(sqlite);
  }

  /** Standards already compiled in this project (so the UI can offer search without recompiling). */
  listCompiled(): import('@shared/domain/standard-schema').CompiledStandardSummary[] {
    const rows = this.sqlite
      .prepare(
        `SELECT s.id AS standardId, s.source_id AS sourceId, s.title AS title,
                (SELECT COUNT(*) FROM clauses WHERE standard_id = s.id) AS clauseCount,
                (SELECT COUNT(*) FROM requirements WHERE standard_id = s.id) AS requirementCount,
                (SELECT COUNT(*) FROM standard_references WHERE from_standard_id = s.id) AS referenceCount
         FROM standards s
         ORDER BY s.created_at DESC`,
      )
      .all() as Array<{
      standardId: string;
      sourceId: string;
      title: string | null;
      clauseCount: number;
      requirementCount: number;
      referenceCount: number;
    }>;
    return rows.map((r) => ({
      standardId: r.standardId,
      sourceId: r.sourceId,
      ...(r.title ? { title: r.title } : {}),
      clauseCount: r.clauseCount,
      requirementCount: r.requirementCount,
      referenceCount: r.referenceCount,
    }));
  }

  async start(input: StartSchemaCompileInput): Promise<{ jobId: string }> {
    const project = this.session.getCurrent();
    if (!project) throw new Error('No project is open.');
    const source = this.sources.getById(input.sourceId);
    if (!source) throw new Error(`Source not found: ${input.sourceId}`);
    if (source.kind !== 'standard_pdf') {
      throw new Error(`Source ${source.id} is not a standard_pdf.`);
    }

    const runner = input.runner ?? this.defaultRunner;
    const handle = await this.bus.create({
      kind: 'schema_compile',
      sourceId: source.id,
      planPayload: {
        kind: 'schema_compile',
        sourceId: source.id,
        runner: runner.id,
        agentSchemaVersion: STANDARD_SCHEMA_VERSION,
        maxSections: maxSections(),
      },
    });

    void this.run(handle, source, runner).catch(async (err) => {
      await handle.finishFailure(err as Error);
    });

    return { jobId: handle.id };
  }

  private async run(handle: JobHandle, source: SourceFile, runner: AgentRunner): Promise<void> {
    const project = this.session.getCurrent();
    if (!project) throw new Error('Project closed during job execution.');

    try {
      await handle.emitProgress(0.02, 'reading extract artifacts');
      const pages = await this.artifacts.readJson<PdfPageInfo[]>(project, {
        scope: 'standards',
        ownerId: source.id,
        name: 'pages.json',
      });
      const textBlocks = await this.artifacts.readJson<PdfTextBlock[]>(project, {
        scope: 'standards',
        ownerId: source.id,
        name: 'text-blocks.json',
      });
      const blockIndex = new Map(textBlocks.map((b) => [b.id, b]));

      // Section map from the printed TOC (reliable page ranges); fall back to a
      // single whole-document chunk when the document has no parseable TOC.
      const absPath = this.sources.resolveAbsolutePath({ directory: project.directory }, source);
      const pdfParser = this.parsers.requirePdf() as PdfParser;
      const sectionMap = await pdfParser.getSectionMap({ filePath: absPath });
      await this.artifacts.writeJson(
        project,
        { scope: 'standards', ownerId: source.id, name: 'sections.json' },
        sectionMap,
      );

      const built = await this.compile({
        handle,
        runner,
        source,
        pages,
        textBlocks,
        blockIndex,
        sectionMap,
      });

      await handle.emitProgress(0.9, 'writing artifacts');
      await this.writeArtifacts(built);
      for (const ref of Object.values(built.refs)) {
        if (ref) await handle.emitArtifactWritten(ref);
      }

      await handle.emitProgress(0.96, 'writing to SQLite');
      this.persistToSqlite(built);

      // Build the standard registry + category tree from what we just compiled.
      const catalogResult = this.catalog.sync({
        standard: built.standard,
        clauses: built.clauses,
        references: built.references,
      });
      await handle.emitLog(
        'info',
        `注册表：导入标准 1 + 引用标准 ${catalogResult.referencedCount}，分类 ${catalogResult.categoryCount} 个。`,
      );

      this.writeAudit('schema_compiled', 'source', source.id, {
        jobId: handle.id,
        runner: runner.id,
        standardId: built.standard.id,
        sectionsProcessed: built.sectionsProcessed,
        sectionsTotal: built.sectionsTotal,
        clauses: built.clauses.length,
        requirements: built.requirements.length,
        citations: built.citations.length,
        references: built.references.length,
        needsReviewRequirements: built.requirements.filter((r) => r.reviewStatus === 'needs_review')
          .length,
      });

      await handle.emitProgress(1, 'done');
      await handle.finishSuccess();
    } catch (err) {
      await handle.finishFailure(err as Error);
      this.writeAudit('schema_compile_failed', 'source', source.id, {
        jobId: handle.id,
        runner: runner.id,
        error: (err as Error).message,
      });
    }
  }

  private async compile(args: {
    handle: JobHandle;
    runner: AgentRunner;
    source: SourceFile;
    pages: PdfPageInfo[];
    textBlocks: PdfTextBlock[];
    blockIndex: Map<string, PdfTextBlock>;
    sectionMap: SectionMap;
  }): Promise<BuiltSchema> {
    const { handle, runner, source, pages, textBlocks, blockIndex, sectionMap } = args;
    const blocksByPage = new Map<number, PdfTextBlock[]>();
    for (const b of textBlocks) {
      const list = blocksByPage.get(b.page) ?? [];
      list.push(b);
      blocksByPage.set(b.page, list);
    }
    const now = new Date().toISOString();
    const standardId = newId('standard');
    const standard: StandardRecord = {
      id: standardId,
      sourceId: source.id,
      title: source.originalName,
      status: 'compiled',
      createdAt: now,
      updatedAt: now,
    };

    const clauses: ClauseRecord[] = [];
    const requirements: RequirementRecord[] = [];
    const references: StandardReferenceRecord[] = [];
    const citations: CitationRecord[] = [];

    // Choose the units of work: real sections when we have a TOC, otherwise one
    // synthetic "whole document" section.
    const contentSections = sectionMap.entries.filter((s) => s.looksLikeContent);
    const selected = contentSections.length > 0 ? contentSections.slice(0, maxSections()) : [];
    const useSections = selected.length > 0;

    if (!useSections) {
      await handle.emitLog(
        'warn',
        sectionMap.source === 'none'
          ? '未能从目录解析出章节，退回整文档单次处理（受 token 上限截断）。'
          : '目录解析到的章节均判为非正文，退回整文档单次处理。',
      );
    } else {
      await handle.emitLog(
        'info',
        `目录解析到 ${sectionMap.entries.length} 节，本次处理前 ${selected.length} 节。`,
      );
    }

    const units = useSections ? selected : [syntheticWholeDocSection(standardId, pages)];

    const perCall = blocksPerCall();
    const maxWindows = windowsPerSection();
    for (let i = 0; i < units.length; i++) {
      const section = units[i];
      if (!section) continue;
      const sectionBlocks = useSections
        ? textBlocks.filter((b) => b.page >= section.pageStart && b.page <= section.pageEnd)
        : textBlocks;

      const sectionLabel = useSections
        ? `第 ${i + 1}/${units.length} 节 · ${section.title} (p${section.pageStart}-${section.pageEnd})`
        : '整文档';
      const sectionBase = 0.1 + (i / units.length) * 0.75;
      const sectionSpan = (1 / units.length) * 0.75;
      await handle.emitProgress(sectionBase, sectionLabel);

      if (sectionBlocks.length === 0) {
        await handle.emitLog('warn', `${sectionLabel}：无文本块，跳过。`);
        continue;
      }

      // The TOC header becomes one root clause; every window's clauses hang under
      // it. Created once so windowing can't duplicate the root row.
      const rootClauseId = useSections ? this.pushSectionRoot(section, standardId, clauses) : null;

      // Window each section into small block-chunks. The model emits ~one
      // requirement per modal verb (shall/must), so a requirement-dense section
      // crammed into one call produces a huge response that blows the timeout
      // (this was the real cause of the section-3+ hangs). Smaller windows keep
      // each response bounded; processing several windows also stops us silently
      // truncating the section to its first N blocks.
      const allWindows = chunkBlocks(sectionBlocks, perCall);
      const windows = allWindows.slice(0, maxWindows);
      const windowSpan = sectionSpan / windows.length;
      if (allWindows.length > 1) {
        const note =
          allWindows.length > windows.length
            ? `，本次处理前 ${windows.length} 个（调 NORMBRIDGE_WINDOWS_PER_SECTION 可加多）`
            : '';
        await handle.emitLog(
          'info',
          `${sectionLabel}：${sectionBlocks.length} 块按每次 ${perCall} 块切成 ${allWindows.length} 窗口${note}。`,
        );
      }

      for (let w = 0; w < windows.length; w++) {
        const windowBlocks = windows[w];
        if (!windowBlocks || windowBlocks.length === 0) continue;
        const windowBase = sectionBase + w * windowSpan;
        const label =
          windows.length > 1 ? `${sectionLabel} · 窗口 ${w + 1}/${windows.length}` : sectionLabel;
        await handle.emitProgress(windowBase, label);

        let raw: {
          clauses: ClauseCompilerOutput;
          requirements: RequirementExtractorOutput;
          references: ReferenceResolverOutput;
        };
        try {
          raw = await args.runner.compile(
            {
              sourceId: source.id,
              sourceOriginalName: useSections
                ? `${source.originalName} · ${section.title}`
                : source.originalName,
              pages: pagesForBlocks(pages, windowBlocks),
              textBlocks: windowBlocks,
            },
            {
              onLog: (level, message) => handle.emitLog(level, `[${runner.id}] ${message}`),
              onProgress: async (_stage, ratio) => {
                await handle.emitProgress(windowBase + ratio * windowSpan, label);
              },
            },
          );
        } catch (err) {
          // One bad window shouldn't abort the whole run during validation.
          await handle.emitLog('error', `${label} 抽取失败：${(err as Error).message}`);
          this.writeAudit('agent_output_invalid', 'source', source.id, {
            jobId: handle.id,
            runner: runner.id,
            section: section.clauseNoGuess ?? section.title,
            window: `${w + 1}/${windows.length}`,
            error: (err as Error).message,
          });
          continue;
        }

        const clausesOut = clauseCompilerOutputSchema.safeParse(raw.clauses);
        const requirementsOut = requirementExtractorOutputSchema.safeParse(raw.requirements);
        const referencesOut = referenceResolverOutputSchema.safeParse(raw.references);
        if (!clausesOut.success || !requirementsOut.success || !referencesOut.success) {
          await handle.emitLog('error', `${label}：agent 输出未通过 schema 校验，跳过。`);
          this.writeAudit('agent_output_invalid', 'source', source.id, {
            jobId: handle.id,
            section: section.clauseNoGuess ?? section.title,
            window: `${w + 1}/${windows.length}`,
          });
          continue;
        }

        this.appendRecords({
          standardId,
          rootClauseId,
          fallbackPageStart: useSections ? section.pageStart : undefined,
          fallbackPageEnd: useSections ? section.pageEnd : undefined,
          source,
          blockIndex,
          blocksByPage,
          clauseOut: clausesOut.data,
          requirementOut: requirementsOut.data,
          referenceOut: referencesOut.data,
          out: { clauses, requirements, references, citations },
        });
      }
    }

    return {
      standard,
      clauses,
      requirements,
      references,
      citations,
      compiledAt: now,
      sectionsProcessed: units.length,
      sectionsTotal: sectionMap.entries.length || 1,
      refs: {
        clauses: '',
        requirements: '',
        citations: '',
        references: '',
        bundle: '',
        sections: '',
      },
    };
  }

  /** Push the TOC header as a root clause once per section; return its id. */
  private pushSectionRoot(
    section: SectionEntry,
    standardId: string,
    outClauses: ClauseRecord[],
  ): string {
    outClauses.push({
      id: section.id,
      standardId,
      parentClauseId: null,
      ...(section.clauseNoGuess ? { clauseNo: section.clauseNoGuess } : {}),
      title: section.title,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      reviewStatus: 'unreviewed',
    });
    return section.id;
  }

  /**
   * Turn one window's agent output into records and append to the shared
   * accumulators. localId↔clauseId mapping is scoped to THIS call so ids never
   * collide across windows/sections; top-level agent clauses hang under the
   * section's root clause (rootClauseId), created once by pushSectionRoot.
   */
  private appendRecords(args: {
    standardId: string;
    rootClauseId: string | null;
    fallbackPageStart: number | undefined;
    fallbackPageEnd: number | undefined;
    source: SourceFile;
    blockIndex: Map<string, PdfTextBlock>;
    blocksByPage: Map<number, PdfTextBlock[]>;
    clauseOut: ClauseCompilerOutput;
    requirementOut: RequirementExtractorOutput;
    referenceOut: ReferenceResolverOutput;
    out: {
      clauses: ClauseRecord[];
      requirements: RequirementRecord[];
      references: StandardReferenceRecord[];
      citations: CitationRecord[];
    };
  }): void {
    const {
      standardId,
      rootClauseId,
      fallbackPageStart,
      fallbackPageEnd,
      source,
      blockIndex,
      blocksByPage,
      clauseOut,
      requirementOut,
      referenceOut,
      out,
    } = args;
    const resolve = (anchors: CitationAnchor[] | null | undefined) =>
      anchorsToCitations(
        anchors,
        source,
        blockIndex,
        blocksByPage,
        fallbackPageStart,
        out.citations,
      );

    const localToClauseId = new Map<string, string>();
    for (const c of clauseOut.clauses) {
      localToClauseId.set(c.localId, newId('clause'));
    }

    for (const c of clauseOut.clauses) {
      const id = localToClauseId.get(c.localId);
      if (!id) continue;
      const parentId = c.parentLocalId
        ? (localToClauseId.get(c.parentLocalId) ?? rootClauseId)
        : rootClauseId;
      const pageStart = c.pageStart ?? fallbackPageStart;
      const pageEnd = c.pageEnd ?? fallbackPageEnd;
      out.clauses.push({
        id,
        standardId,
        parentClauseId: parentId,
        ...(c.clauseNo ? { clauseNo: c.clauseNo } : {}),
        ...(c.title ? { title: c.title } : {}),
        ...(pageStart !== undefined ? { pageStart } : {}),
        ...(pageEnd !== undefined ? { pageEnd } : {}),
        ...(c.rawText ? { rawText: c.rawText } : {}),
        reviewStatus: 'unreviewed',
      });
    }

    for (const r of requirementOut.requirements) {
      const citationIds = resolve(r.citationAnchors);
      const clauseId =
        (r.localClauseId ? localToClauseId.get(r.localClauseId) : undefined) ??
        rootClauseId ??
        undefined;
      out.requirements.push({
        id: newId('requirement'),
        standardId,
        ...(clauseId ? { clauseId } : {}),
        ...(r.subject ? { subject: r.subject } : {}),
        ...(r.appliesTo ? { appliesTo: r.appliesTo } : {}),
        ...(r.conditionText ? { conditionText: r.conditionText } : {}),
        requirementText: r.requirementText,
        ...(r.parameterName ? { parameterName: r.parameterName } : {}),
        ...(r.operator ? { operator: r.operator } : {}),
        ...(r.valueText ? { valueText: r.valueText } : {}),
        ...(r.unit ? { unit: r.unit } : {}),
        ...(r.testMethod ? { testMethod: r.testMethod } : {}),
        ...(r.evidenceRequired ? { evidenceRequired: r.evidenceRequired } : {}),
        ...(r.severity ? { severity: r.severity } : {}),
        confidence: r.confidence ?? 0.5,
        citationIds,
        reviewStatus: citationIds.length === 0 ? 'needs_review' : 'unreviewed',
      });
    }

    for (const ref of referenceOut.references) {
      const citationIds = resolve(ref.citationAnchors);
      const fromClauseId = ref.fromLocalClauseId
        ? (localToClauseId.get(ref.fromLocalClauseId) ?? rootClauseId ?? undefined)
        : (rootClauseId ?? undefined);
      out.references.push({
        id: newId('reference'),
        fromStandardId: standardId,
        ...(fromClauseId ? { fromClauseId } : {}),
        referencedStandardCode: ref.referencedStandardCode,
        ...(ref.referencedClause ? { referencedClause: ref.referencedClause } : {}),
        ...(ref.relationType ? { relationType: ref.relationType } : {}),
        citationIds,
        reviewStatus: citationIds.length === 0 ? 'needs_review' : 'unreviewed',
      });
    }
  }

  private async writeArtifacts(built: BuiltSchema): Promise<void> {
    const project = this.session.getCurrent();
    if (!project) throw new Error('Project closed before artifact write.');
    const sourceId = built.standard.sourceId;

    const write = async (name: string, data: unknown) =>
      (
        await this.artifacts.writeJson(
          project,
          { scope: 'standards', ownerId: sourceId, name },
          data,
        )
      ).relativePath;

    built.refs.clauses = await write('clauses.json', built.clauses);
    built.refs.requirements = await write('requirements.json', built.requirements);
    built.refs.citations = await write('citations.json', built.citations);
    built.refs.references = await write('references.json', built.references);

    const bundle: StandardSchemaArtifact = {
      schemaVersion: STANDARD_SCHEMA_VERSION,
      standard: built.standard,
      clauses: built.clauses,
      requirements: built.requirements,
      citations: built.citations,
      references: built.references,
      compiledAt: built.compiledAt,
    };
    const parsed = standardSchemaArtifactSchema.safeParse(bundle);
    if (!parsed.success) {
      throw new Error(`standard-schema bundle failed validation: ${parsed.error.message}`);
    }
    built.refs.bundle = await write('standard-schema.v0.1.json', bundle);
  }

  private persistToSqlite(built: BuiltSchema): void {
    this.sqlite.tx(() => {
      // Re-compile replaces, never appends. Clear every row owned by prior
      // compiles of this source so a second run can't duplicate clauses or leave
      // a stale empty `standards` row behind. Children first, `standards` last,
      // so the `WHERE source_id` subqueries still resolve. The catalog FK is
      // nulled (the entry itself is re-linked by CatalogService.sync afterwards).
      this.deletePriorForSource(built.standard.sourceId);

      this.sqlite
        .prepare(
          `INSERT INTO standards (id, source_id, title, country_or_region, version, publication_date, scope, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          built.standard.id,
          built.standard.sourceId,
          built.standard.title ?? null,
          built.standard.countryOrRegion ?? null,
          built.standard.version ?? null,
          built.standard.publicationDate ?? null,
          built.standard.scope ?? null,
          built.standard.status,
          built.standard.createdAt,
          built.standard.updatedAt,
        );

      const insCit = this.sqlite.prepare(
        `INSERT INTO citations (id, source_id, source_hash, page, sheet_name, cell_ref, paragraph_index, table_index, clause_no, text_start, text_end, bbox_json, quote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of built.citations) {
        insCit.run(
          c.id,
          c.sourceId,
          c.sourceHash,
          c.page ?? null,
          c.sheetName ?? null,
          c.cellRef ?? null,
          c.paragraphIndex ?? null,
          c.tableIndex ?? null,
          c.clauseNo ?? null,
          c.textStart ?? null,
          c.textEnd ?? null,
          c.bbox ? JSON.stringify(c.bbox) : null,
          c.quote,
        );
      }

      const insCls = this.sqlite.prepare(
        `INSERT INTO clauses (id, standard_id, parent_clause_id, clause_no, title, page_start, page_end, raw_text, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of built.clauses) {
        insCls.run(
          c.id,
          c.standardId,
          c.parentClauseId,
          c.clauseNo ?? null,
          c.title ?? null,
          c.pageStart ?? null,
          c.pageEnd ?? null,
          c.rawText ?? null,
          c.reviewStatus,
        );
      }

      const insReq = this.sqlite.prepare(
        `INSERT INTO requirements (id, standard_id, clause_id, subject, applies_to, condition_text, requirement_text, parameter_name, operator, value_text, unit, test_method, evidence_required, severity, confidence, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insReqCit = this.sqlite.prepare(
        `INSERT INTO requirement_citations (requirement_id, citation_id) VALUES (?, ?)`,
      );
      for (const r of built.requirements) {
        insReq.run(
          r.id,
          r.standardId,
          r.clauseId ?? null,
          r.subject ?? null,
          r.appliesTo ?? null,
          r.conditionText ?? null,
          r.requirementText,
          r.parameterName ?? null,
          r.operator ?? null,
          r.valueText ?? null,
          r.unit ?? null,
          r.testMethod ?? null,
          r.evidenceRequired ?? null,
          r.severity ?? null,
          r.confidence,
          r.reviewStatus,
        );
        for (const cid of r.citationIds) insReqCit.run(r.id, cid);
      }

      const insRef = this.sqlite.prepare(
        `INSERT INTO standard_references (id, from_standard_id, from_clause_id, referenced_standard_code, referenced_clause, relation_type, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const ref of built.references) {
        insRef.run(
          ref.id,
          ref.fromStandardId,
          ref.fromClauseId ?? null,
          ref.referencedStandardCode,
          ref.referencedClause ?? null,
          ref.relationType ?? null,
          ref.reviewStatus,
        );
      }
    });
  }

  /**
   * Drop all rows from prior compiles of `sourceId` so a re-compile replaces
   * instead of appending. Runs inside the persist transaction. Order matters
   * under `PRAGMA foreign_keys = ON`: delete children before parents, null the
   * catalog → standards FK, and delete `standards` last so the `source_id`
   * subqueries keep resolving.
   */
  private deletePriorForSource(sourceId: string): void {
    const owned = '(SELECT id FROM standards WHERE source_id = ?)';
    this.sqlite
      .prepare(
        `DELETE FROM requirement_citations WHERE requirement_id IN
           (SELECT id FROM requirements WHERE standard_id IN ${owned})`,
      )
      .run(sourceId);
    this.sqlite.prepare(`DELETE FROM requirements WHERE standard_id IN ${owned}`).run(sourceId);
    this.sqlite
      .prepare(`DELETE FROM standard_references WHERE from_standard_id IN ${owned}`)
      .run(sourceId);
    this.sqlite.prepare(`DELETE FROM clauses WHERE standard_id IN ${owned}`).run(sourceId);
    this.sqlite.prepare('DELETE FROM citations WHERE source_id = ?').run(sourceId);
    this.sqlite
      .prepare(`UPDATE standard_catalog SET standard_id = NULL WHERE standard_id IN ${owned}`)
      .run(sourceId);
    this.sqlite.prepare('DELETE FROM standards WHERE source_id = ?').run(sourceId);
  }

  private writeAudit(
    eventType: string,
    targetType: 'source',
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

function syntheticWholeDocSection(_standardId: string, pages: PdfPageInfo[]): SectionEntry {
  const last = pages[pages.length - 1];
  return {
    id: newId('clause'),
    title: 'Whole document',
    pageStart: 1,
    pageEnd: last?.page ?? 1,
    level: 0,
    looksLikeContent: true,
  };
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build citation rows from anchors. Models give us a verbatim `quote` + maybe a
 * `page`; they can't reliably echo our internal block ids, so we resolve blocks
 * by matching the quote against the page's text. The citation address (page +
 * quote) is always kept even when no block matches (bbox just stays absent).
 */
function anchorsToCitations(
  anchors: CitationAnchor[] | null | undefined,
  source: SourceFile,
  blockIndex: Map<string, PdfTextBlock>,
  blocksByPage: Map<number, PdfTextBlock[]>,
  fallbackPage: number | undefined,
  out: CitationRecord[],
): string[] {
  if (!anchors || anchors.length === 0) return [];
  const ids: string[] = [];
  for (const a of anchors) {
    const page = a.page ?? fallbackPage;

    // 1. explicit block ids (mock / future), else 2. quote-match on the page.
    let blocks: PdfTextBlock[] = [];
    if (a.textBlockIds && a.textBlockIds.length > 0) {
      blocks = a.textBlockIds.map((id) => blockIndex.get(id)).filter(Boolean) as PdfTextBlock[];
    } else if (page !== undefined) {
      const quoteNorm = normalizeForMatch(a.quote);
      blocks = (blocksByPage.get(page) ?? [])
        .filter((b) => {
          const t = normalizeForMatch(b.text);
          return t.length >= 3 && (quoteNorm.includes(t) || t.includes(quoteNorm));
        })
        .slice(0, 12);
    }

    const cit: CitationRecord = {
      id: newId('citation'),
      sourceId: source.id,
      sourceHash: source.sha256,
      ...(page !== undefined ? { page } : {}),
      quote: a.quote,
    };
    if (blocks.length > 0) {
      const xs = blocks.map((b) => b.bbox.x);
      const ys = blocks.map((b) => b.bbox.y);
      const xsEnd = blocks.map((b) => b.bbox.x + b.bbox.w);
      const ysEnd = blocks.map((b) => b.bbox.y + b.bbox.h);
      cit.bbox = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xsEnd) - Math.min(...xs),
        Math.max(...ysEnd) - Math.min(...ys),
      ];
    }
    out.push(cit);
    ids.push(cit.id);
  }
  return ids;
}
