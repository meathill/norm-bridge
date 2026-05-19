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
  ClauseCandidate,
  ReferenceCandidate,
  RequirementCandidate,
} from '@shared/schemas/agent-outputs';
import {
  clauseCompilerOutputSchema,
  referenceResolverOutputSchema,
  requirementExtractorOutputSchema,
} from '@shared/schemas/agent-outputs';
import { standardSchemaArtifactSchema } from '@shared/schemas/standard-schema.v0.1';
import type { AgentCompileResult, AgentRunner } from '@agents/agent-runner';
import { newId } from '@shared/ids';
import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import type { SourceFile } from '@shared/domain/source';
import type { ArtifactStore } from './artifact-store';
import type { JobBus, JobHandle } from './job-bus';
import type { ProjectSession } from './project-session';
import type { SourceRegistry } from './source-registry';
import type { SqliteService } from './sqlite-service';

export type StartSchemaCompileInput = {
  sourceId: string;
  /** If absent, falls back to the runner the service was constructed with. */
  runner?: AgentRunner;
};

export type SchemaCompileSummary = {
  standardId: string;
  clauseCount: number;
  requirementCount: number;
  citationCount: number;
  referenceCount: number;
  needsReviewCount: number;
};

export class SchemaCompileService {
  constructor(
    private readonly session: ProjectSession,
    private readonly sources: SourceRegistry,
    private readonly artifacts: ArtifactStore,
    private readonly bus: JobBus,
    private readonly sqlite: SqliteService,
    private readonly defaultRunner: AgentRunner,
  ) {}

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

      await handle.emitProgress(0.1, `running ${runner.id}`);
      let raw: AgentCompileResult;
      try {
        raw = await runner.compile(
          {
            sourceId: source.id,
            sourceOriginalName: source.originalName,
            pages,
            textBlocks,
          },
          {
            onLog: (level, message) => handle.emitLog(level, `[${runner.id}] ${message}`),
            onProgress: async (stage, ratio) => {
              const stageOffset = stage === 'clauses' ? 0.1 : stage === 'requirements' ? 0.4 : 0.65;
              await handle.emitProgress(stageOffset + ratio * 0.2, `${stage}`);
            },
          },
        );
      } catch (err) {
        await this.recordAgentFailure(handle, source.id, runner.id, err as Error);
        throw err;
      }

      // Defensive re-validation; the runner already returned typed values but we
      // belt-and-brace this so a bad mock or out-of-band SDK update fails loud.
      const clausesOut = clauseCompilerOutputSchema.safeParse(raw.clauses);
      const requirementsOut = requirementExtractorOutputSchema.safeParse(raw.requirements);
      const referencesOut = referenceResolverOutputSchema.safeParse(raw.references);
      if (!clausesOut.success || !requirementsOut.success || !referencesOut.success) {
        const reason = [
          !clausesOut.success ? `clauses: ${clausesOut.error?.message}` : null,
          !requirementsOut.success ? `requirements: ${requirementsOut.error?.message}` : null,
          !referencesOut.success ? `references: ${referencesOut.error?.message}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        const err = new Error(`agent_output_invalid: ${reason}`);
        await this.recordAgentFailure(handle, source.id, runner.id, err);
        throw err;
      }

      const built = this.buildRecords({
        source,
        pages,
        textBlocks,
        blockIndex,
        clauses: clausesOut.data.clauses,
        requirements: requirementsOut.data.requirements,
        references: referencesOut.data.references,
      });

      await handle.emitProgress(0.85, 'writing artifacts');
      await this.writeArtifacts(built);
      for (const ref of [
        built.refs.clauses,
        built.refs.requirements,
        built.refs.citations,
        built.refs.references,
        built.refs.bundle,
      ]) {
        await handle.emitArtifactWritten(ref);
      }

      await handle.emitProgress(0.95, 'writing to SQLite');
      this.persistToSqlite(built);

      this.writeAudit('schema_compiled', 'source', source.id, {
        jobId: handle.id,
        runner: runner.id,
        standardId: built.standard.id,
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

  private buildRecords(input: {
    source: SourceFile;
    pages: PdfPageInfo[];
    textBlocks: PdfTextBlock[];
    blockIndex: Map<string, PdfTextBlock>;
    clauses: ClauseCandidate[];
    requirements: RequirementCandidate[];
    references: ReferenceCandidate[];
  }) {
    const now = new Date().toISOString();
    const standardId = newId('standard');
    const standard: StandardRecord = {
      id: standardId,
      sourceId: input.source.id,
      title: input.source.originalName,
      status: 'compiled',
      createdAt: now,
      updatedAt: now,
    };

    const citations: CitationRecord[] = [];
    const localToClauseId = new Map<string, string>();

    const clauseRecords: ClauseRecord[] = [];
    // First pass: assign clause ids.
    for (const c of input.clauses) {
      const id = newId('clause');
      localToClauseId.set(c.localId, id);
    }
    // Second pass: build records (so parent ids are resolvable).
    for (const c of input.clauses) {
      const id = localToClauseId.get(c.localId);
      if (!id) continue;
      // Build citations for this clause's anchors.
      const clauseCitationIds = anchorsToCitations(
        c.citationAnchors,
        input.source,
        input.blockIndex,
        citations,
      );
      clauseRecords.push({
        id,
        standardId,
        parentClauseId: c.parentLocalId ? (localToClauseId.get(c.parentLocalId) ?? null) : null,
        ...(c.clauseNo ? { clauseNo: c.clauseNo } : {}),
        ...(c.title ? { title: c.title } : {}),
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        ...(c.rawText ? { rawText: c.rawText } : {}),
        reviewStatus: 'unreviewed',
      });
      // Citations are not pinned to the clause directly in the table, but we still
      // need them written so requirement and reference rows can FK to them.
      void clauseCitationIds;
    }

    const requirementRecords: RequirementRecord[] = [];
    for (const r of input.requirements) {
      const citationIds = anchorsToCitations(
        r.citationAnchors,
        input.source,
        input.blockIndex,
        citations,
      );
      const clauseId = localToClauseId.get(r.localClauseId);
      const reviewStatus: RequirementRecord['reviewStatus'] =
        citationIds.length === 0 ? 'needs_review' : 'unreviewed';
      const record: RequirementRecord = {
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
        reviewStatus,
      };
      requirementRecords.push(record);
    }

    const referenceRecords: StandardReferenceRecord[] = [];
    for (const ref of input.references) {
      const citationIds = anchorsToCitations(
        ref.citationAnchors,
        input.source,
        input.blockIndex,
        citations,
      );
      referenceRecords.push({
        id: newId('reference'),
        fromStandardId: standardId,
        ...(ref.fromLocalClauseId
          ? { fromClauseId: localToClauseId.get(ref.fromLocalClauseId) }
          : {}),
        referencedStandardCode: ref.referencedStandardCode,
        ...(ref.referencedClause ? { referencedClause: ref.referencedClause } : {}),
        ...(ref.relationType ? { relationType: ref.relationType } : {}),
        citationIds,
        reviewStatus: citationIds.length === 0 ? 'needs_review' : 'unreviewed',
      });
    }

    return {
      standard,
      clauses: clauseRecords,
      requirements: requirementRecords,
      references: referenceRecords,
      citations,
      compiledAt: now,
      refs: {
        clauses: '',
        requirements: '',
        citations: '',
        references: '',
        bundle: '',
      } as {
        clauses: string;
        requirements: string;
        citations: string;
        references: string;
        bundle: string;
      },
    };
  }

  private async writeArtifacts(built: ReturnType<typeof this.buildRecords>): Promise<void> {
    const project = this.session.getCurrent();
    if (!project) throw new Error('Project closed before artifact write.');

    const sourceId = built.standard.sourceId;

    const clausesRef = await this.artifacts.writeJson(
      project,
      { scope: 'standards', ownerId: sourceId, name: 'clauses.json' },
      built.clauses,
    );
    const reqsRef = await this.artifacts.writeJson(
      project,
      { scope: 'standards', ownerId: sourceId, name: 'requirements.json' },
      built.requirements,
    );
    const citationsRef = await this.artifacts.writeJson(
      project,
      { scope: 'standards', ownerId: sourceId, name: 'citations.json' },
      built.citations,
    );
    const referencesRef = await this.artifacts.writeJson(
      project,
      { scope: 'standards', ownerId: sourceId, name: 'references.json' },
      built.references,
    );

    const bundle: StandardSchemaArtifact = {
      schemaVersion: STANDARD_SCHEMA_VERSION,
      standard: built.standard,
      clauses: built.clauses,
      requirements: built.requirements,
      citations: built.citations,
      references: built.references,
      compiledAt: built.compiledAt,
    };
    // Validate the bundled artifact before we commit anything to disk irrevocably.
    const parsed = standardSchemaArtifactSchema.safeParse(bundle);
    if (!parsed.success) {
      throw new Error(`standard-schema bundle failed validation: ${parsed.error.message}`);
    }

    const bundleRef = await this.artifacts.writeJson(
      project,
      { scope: 'standards', ownerId: sourceId, name: 'standard-schema.v0.1.json' },
      bundle,
    );

    built.refs.clauses = clausesRef.relativePath;
    built.refs.requirements = reqsRef.relativePath;
    built.refs.citations = citationsRef.relativePath;
    built.refs.references = referencesRef.relativePath;
    built.refs.bundle = bundleRef.relativePath;
  }

  private persistToSqlite(built: ReturnType<typeof this.buildRecords>): void {
    this.sqlite.tx(() => {
      const insStd = this.sqlite.prepare(
        `INSERT INTO standards (id, source_id, title, country_or_region, version, publication_date, scope, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const s = built.standard;
      insStd.run(
        s.id,
        s.sourceId,
        s.title ?? null,
        s.countryOrRegion ?? null,
        s.version ?? null,
        s.publicationDate ?? null,
        s.scope ?? null,
        s.status,
        s.createdAt,
        s.updatedAt,
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
        for (const cid of r.citationIds) {
          insReqCit.run(r.id, cid);
        }
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

  private async recordAgentFailure(
    handle: JobHandle,
    sourceId: string,
    runnerId: string,
    err: Error,
  ): Promise<void> {
    await handle.emitLog('error', `agent failure: ${err.message}`);
    this.writeAudit('agent_output_invalid', 'source', sourceId, {
      jobId: handle.id,
      runner: runnerId,
      error: err.message,
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

function anchorsToCitations(
  anchors: CitationAnchor[],
  source: SourceFile,
  blockIndex: Map<string, PdfTextBlock>,
  out: CitationRecord[],
): string[] {
  const ids: string[] = [];
  for (const a of anchors) {
    // Compute a bbox union from the anchor's text blocks when they exist; otherwise skip.
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
