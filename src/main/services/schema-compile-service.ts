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

/** How many sections to process per compile run while we validate the approach. */
function maxSections(): number {
  const raw = (process.env['NORMBRIDGE_MAX_SECTIONS'] ?? '').trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 5;
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

    for (let i = 0; i < units.length; i++) {
      const section = units[i];
      if (!section) continue;
      const sectionBlocks = useSections
        ? textBlocks.filter((b) => b.page >= section.pageStart && b.page <= section.pageEnd)
        : textBlocks;
      const sectionPages = pages.filter(
        (p) => p.page >= section.pageStart && p.page <= section.pageEnd,
      );

      const label = useSections
        ? `第 ${i + 1}/${units.length} 节 · ${section.title} (p${section.pageStart}-${section.pageEnd})`
        : '整文档';
      await handle.emitProgress(0.1 + (i / units.length) * 0.75, label);

      if (sectionBlocks.length === 0) {
        await handle.emitLog('warn', `${label}：无文本块，跳过。`);
        continue;
      }

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
            pages: sectionPages,
            textBlocks: sectionBlocks,
          },
          {
            onLog: (level, message) => handle.emitLog(level, `[${runner.id}] ${message}`),
          },
        );
      } catch (err) {
        // One bad section shouldn't abort the whole run during validation.
        await handle.emitLog('error', `${label} 抽取失败：${(err as Error).message}`);
        this.writeAudit('agent_output_invalid', 'source', source.id, {
          jobId: handle.id,
          runner: runner.id,
          section: section.clauseNoGuess ?? section.title,
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
        });
        continue;
      }

      this.appendSectionRecords({
        standardId,
        section: useSections ? section : null,
        source,
        blockIndex,
        clauseOut: clausesOut.data,
        requirementOut: requirementsOut.data,
        referenceOut: referencesOut.data,
        out: { clauses, requirements, references, citations },
      });
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

  /**
   * Turn one section's agent output into records and append to the shared
   * accumulators. localId↔clauseId mapping is scoped to this section so ids
   * never collide across sections. When a section header is known (from the
   * TOC), it becomes a synthetic root clause and top-level agent clauses hang
   * under it.
   */
  private appendSectionRecords(args: {
    standardId: string;
    section: SectionEntry | null;
    source: SourceFile;
    blockIndex: Map<string, PdfTextBlock>;
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
      section,
      source,
      blockIndex,
      clauseOut,
      requirementOut,
      referenceOut,
      out,
    } = args;

    let rootClauseId: string | null = null;
    if (section) {
      rootClauseId = section.id;
      out.clauses.push({
        id: section.id,
        standardId,
        parentClauseId: null,
        ...(section.clauseNoGuess ? { clauseNo: section.clauseNoGuess } : {}),
        title: section.title,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        reviewStatus: 'unreviewed',
      });
    }

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
      out.clauses.push({
        id,
        standardId,
        parentClauseId: parentId,
        ...(c.clauseNo ? { clauseNo: c.clauseNo } : {}),
        ...(c.title ? { title: c.title } : {}),
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        ...(c.rawText ? { rawText: c.rawText } : {}),
        reviewStatus: 'unreviewed',
      });
    }

    for (const r of requirementOut.requirements) {
      const citationIds = anchorsToCitations(r.citationAnchors, source, blockIndex, out.citations);
      const clauseId = localToClauseId.get(r.localClauseId) ?? rootClauseId ?? undefined;
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
        confidence: r.confidence,
        citationIds,
        reviewStatus: citationIds.length === 0 ? 'needs_review' : 'unreviewed',
      });
    }

    for (const ref of referenceOut.references) {
      const citationIds = anchorsToCitations(
        ref.citationAnchors,
        source,
        blockIndex,
        out.citations,
      );
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

function anchorsToCitations(
  anchors: CitationAnchor[],
  source: SourceFile,
  blockIndex: Map<string, PdfTextBlock>,
  out: CitationRecord[],
): string[] {
  const ids: string[] = [];
  for (const a of anchors) {
    const blocks = a.textBlockIds.map((id) => blockIndex.get(id)).filter(Boolean) as PdfTextBlock[];
    if (blocks.length === 0) continue;
    const xs = blocks.map((b) => b.bbox.x);
    const ys = blocks.map((b) => b.bbox.y);
    const xsEnd = blocks.map((b) => b.bbox.x + b.bbox.w);
    const ysEnd = blocks.map((b) => b.bbox.y + b.bbox.h);
    const bbox: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xsEnd) - Math.min(...xs),
      Math.max(...ysEnd) - Math.min(...ys),
    ];
    const cit: CitationRecord = {
      id: newId('citation'),
      sourceId: source.id,
      sourceHash: source.sha256,
      page: a.page,
      bbox,
      quote: a.quote,
    };
    out.push(cit);
    ids.push(cit.id);
  }
  return ids;
}
