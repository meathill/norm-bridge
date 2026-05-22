import type { PdfTextBlock } from '@shared/domain/pdf-extract';
import {
  type ClauseCandidate,
  type ClauseCompilerOutput,
  type ReferenceCandidate,
  type ReferenceResolverOutput,
  type RequirementCandidate,
  type RequirementExtractorOutput,
} from '@shared/schemas/agent-outputs';
import type {
  AgentCompileCallbacks,
  AgentCompileContext,
  AgentCompileResult,
  AgentRunner,
} from './agent-runner';

/**
 * Pure-heuristic AgentRunner. No network calls, no API key. Good enough to
 * give NormBridge a working demo on the deterministic pipeline (artifacts +
 * SQLite + citation gate) without needing an LLM key in CI or first-run UX.
 *
 * Detection rules (intentionally conservative):
 *   - Clause heading: text block starting with "N", "N.N", "N.N.N" + space + (optional Title-cased word)
 *   - Requirement sentence: text block whose normalized text contains "shall" or "must" (modal verbs)
 *   - Reference: text block containing patterns like "IEC 60898-1", "GB/T 14048", "EN 60898"
 *
 * Everything emits citationAnchors back to the block IDs, satisfying the
 * citation gate without inventing quotes.
 */
export class MockAgentRunner implements AgentRunner {
  readonly id = 'mock';

  async compile(
    ctx: AgentCompileContext,
    callbacks?: AgentCompileCallbacks,
  ): Promise<AgentCompileResult> {
    const lines = groupBlocksIntoLines(ctx.textBlocks);

    await callbacks?.onLog?.(
      'info',
      `mock-agent-runner: ${lines.length} lines from ${ctx.textBlocks.length} blocks`,
    );

    const clauses = detectClauses(lines);
    await callbacks?.onProgress?.('clauses', 1);
    await callbacks?.onLog?.('info', `mock-agent-runner: detected ${clauses.length} clauses`);

    const requirements = detectRequirements(lines, clauses);
    await callbacks?.onProgress?.('requirements', 1);
    await callbacks?.onLog?.(
      'info',
      `mock-agent-runner: detected ${requirements.length} requirement candidates`,
    );

    const references = detectReferences(lines);
    await callbacks?.onProgress?.('references', 1);
    await callbacks?.onLog?.(
      'info',
      `mock-agent-runner: detected ${references.length} reference candidates`,
    );

    const compiler: ClauseCompilerOutput = { clauses };
    const requirementOut: RequirementExtractorOutput = { requirements };
    const referenceOut: ReferenceResolverOutput = { references };
    return { clauses: compiler, requirements: requirementOut, references: referenceOut };
  }
}

type Line = {
  page: number;
  text: string;
  blockIds: string[];
};

function groupBlocksIntoLines(blocks: PdfTextBlock[]): Line[] {
  const lines: Line[] = [];
  // Group consecutive blocks on the same page where the bbox y differs by less than ~3pt.
  let current: Line | null = null;
  let lastY: number | null = null;
  let lastPage: number | null = null;

  for (const b of blocks) {
    const sameLine =
      current !== null && lastPage === b.page && lastY !== null && Math.abs(b.bbox.y - lastY) < 3;
    if (sameLine && current) {
      current.text += b.text;
      current.blockIds.push(b.id);
    } else {
      if (current) lines.push(current);
      current = { page: b.page, text: b.text, blockIds: [b.id] };
    }
    lastPage = b.page;
    lastY = b.bbox.y;
  }
  if (current) lines.push(current);

  // Trim and drop empty lines.
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);
}

const CLAUSE_HEADING_RE = /^(\d+(?:\.\d+){0,4})\s+(.{1,200})$/;
const REFERENCE_RE = /\b(?:IEC|EN|ISO|GB(?:\/T)?|UL|JIS|AS\/NZS|BS|DIN)\s?[\w./-]+(?::?\d{4})?/g;
const REQUIREMENT_RE = /\b(shall|shall not|must|must not)\b/i;

function detectClauses(lines: Line[]): ClauseCandidate[] {
  const clauses: ClauseCandidate[] = [];
  // Group lines by detected heading until the next heading appears.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    const match = CLAUSE_HEADING_RE.exec(line.text);
    if (!match) {
      i++;
      continue;
    }
    const clauseNo = match[1];
    const title = match[2]?.trim();
    if (!clauseNo || !title || title.length < 2) {
      i++;
      continue;
    }

    // Collect body lines until the next clause heading or document end.
    let j = i + 1;
    const bodyLines: Line[] = [];
    while (j < lines.length) {
      const next = lines[j];
      if (!next) {
        j++;
        continue;
      }
      if (CLAUSE_HEADING_RE.test(next.text)) break;
      bodyLines.push(next);
      j++;
    }

    const allBlockIds = [line.blockIds, ...bodyLines.map((l) => l.blockIds)].flat();
    const pageStart = line.page;
    const pageEnd =
      bodyLines.length > 0 ? (bodyLines[bodyLines.length - 1]?.page ?? pageStart) : pageStart;
    const parentLocalId = findParentLocalId(clauseNo, clauses);
    const rawText = bodyLines.map((l) => l.text).join('\n');

    clauses.push({
      localId: `c_${clauseNo}`,
      parentLocalId,
      clauseNo,
      title,
      pageStart,
      pageEnd,
      ...(rawText ? { rawText } : {}),
      confidence: 0.6,
      citationAnchors: [
        {
          page: pageStart,
          textBlockIds: dedupe(allBlockIds).slice(0, 16),
          quote: `${clauseNo} ${title}`.slice(0, 200),
        },
      ],
    });

    i = j;
  }
  return clauses;
}

function findParentLocalId(clauseNo: string, prior: ClauseCandidate[]): string | null {
  const parts = clauseNo.split('.');
  if (parts.length <= 1) return null;
  parts.pop();
  const parentNo = parts.join('.');
  const parent = [...prior].reverse().find((c) => c.clauseNo === parentNo);
  return parent?.localId ?? null;
}

function detectRequirements(lines: Line[], clauses: ClauseCandidate[]): RequirementCandidate[] {
  if (clauses.length === 0) return [];
  const requirements: RequirementCandidate[] = [];
  for (const line of lines) {
    if (!REQUIREMENT_RE.test(line.text)) continue;
    const owner = ownerClauseFor(line, clauses);
    if (!owner) continue;
    requirements.push({
      localClauseId: owner.localId,
      requirementText: line.text.slice(0, 800),
      confidence: 0.5,
      severity: /\b(shall not|must not)\b/i.test(line.text) ? 'mandatory' : 'mandatory',
      citationAnchors: [
        {
          page: line.page,
          textBlockIds: line.blockIds,
          quote: line.text.slice(0, 280),
        },
      ],
    });
  }
  return requirements;
}

function ownerClauseFor(line: Line, clauses: ClauseCandidate[]): ClauseCandidate | null {
  // The owning clause is the most recent clause whose pageStart..pageEnd covers this line.
  let best: ClauseCandidate | null = null;
  for (const c of clauses) {
    if (c.pageStart === undefined || c.pageEnd === undefined) continue;
    if (c.pageStart <= line.page && line.page <= c.pageEnd) {
      best = c;
    }
  }
  return best;
}

function detectReferences(lines: Line[]): ReferenceCandidate[] {
  const references: ReferenceCandidate[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    REFERENCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null = REFERENCE_RE.exec(line.text);
    while (m) {
      const code = m[0].trim();
      const key = `${code}::${line.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push({
          referencedStandardCode: code,
          confidence: 0.45,
          relationType: 'unknown',
          citationAnchors: [
            { page: line.page, textBlockIds: line.blockIds, quote: line.text.slice(0, 200) },
          ],
        });
      }
      m = REFERENCE_RE.exec(line.text);
    }
  }
  return references;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
