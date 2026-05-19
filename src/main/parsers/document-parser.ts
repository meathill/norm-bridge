import type { DocumentInspection } from '@shared/domain/inspection';

/**
 * TECH_SPEC §6.2 — Parser Adapter Interface.
 * v0.1 implements only `inspect`; `extract` is added in Step 3 (M2b).
 */
export type ParserSupportInput = {
  mimeType?: string;
  extension: string;
};

export type ParserInspectInput = {
  filePath: string;
};

export interface DocumentParser {
  readonly name: string;
  supports(input: ParserSupportInput): boolean;
  inspect(input: ParserInspectInput): Promise<DocumentInspection>;
}
