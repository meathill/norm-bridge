import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import type {
  ClauseCompilerOutput,
  ReferenceResolverOutput,
  RequirementExtractorOutput,
} from '@shared/schemas/agent-outputs';

export type AgentLogLevel = 'info' | 'warn' | 'error';

export type AgentCompileContext = {
  sourceId: string;
  sourceOriginalName: string;
  pages: PdfPageInfo[];
  textBlocks: PdfTextBlock[];
};

export type AgentCompileCallbacks = {
  onLog?: (level: AgentLogLevel, message: string) => Promise<void> | void;
  onProgress?: (
    stage: 'clauses' | 'requirements' | 'references',
    ratio: number,
  ) => Promise<void> | void;
};

export type AgentCompileResult = {
  clauses: ClauseCompilerOutput;
  requirements: RequirementExtractorOutput;
  references: ReferenceResolverOutput;
};

/**
 * Abstraction over "how do we turn text blocks into a structured schema":
 *   - MockAgentRunner uses regex/heuristics (no API key needed, deterministic).
 *   - OpenAiAgentRunner uses the OpenAI Agents SDK with three skill agents.
 *
 * The interface stays narrow on purpose so SchemaCompileService is identical
 * either way.
 */
export interface AgentRunner {
  readonly id: string;
  compile(ctx: AgentCompileContext, callbacks?: AgentCompileCallbacks): Promise<AgentCompileResult>;
}
