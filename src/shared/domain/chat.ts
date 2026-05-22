import type { DocumentInspection } from './inspection';
import type { SearchResultCard } from './search';
import type { SourceFile } from './source';

/** Each variant carries enough state for the renderer to render and update it. */

export type ChatMessageBase = {
  id: string;
  createdAt: string;
};

export type ChatSystemMessage = ChatMessageBase & {
  type: 'system';
  variant?: 'info' | 'success' | 'warning' | 'error';
  text: string;
  /** Render compact (monospace, muted) — used for operational log lines. */
  dense?: boolean;
};

export type ChatUserTextMessage = ChatMessageBase & {
  type: 'user-text';
  text: string;
};

export type ChatUserFileMessage = ChatMessageBase & {
  type: 'user-file';
  fileName: string;
  /** Absolute path on disk; used to call the backend import. */
  filePath: string;
  sizeBytes?: number;
};

export type ChatInspectionMessage = ChatMessageBase & {
  type: 'inspection';
  source: SourceFile;
  inspection: DocumentInspection;
  /** True until the user clicks "开始分析" or compile/extract has begun. */
  awaitingStart: boolean;
};

/**
 * A long-lived progress message that the renderer mutates in place as job
 * events flow in. Once the underlying job finishes, the message is rewritten
 * to its terminal text.
 */
export type ChatJobMessage = ChatMessageBase & {
  type: 'job';
  jobId: string;
  kind: 'standard_extract' | 'schema_compile';
  status: 'running' | 'succeeded' | 'failed';
  progress: number; // 0..1
  message?: string;
  error?: string;
  sourceId: string;
};

/** The chat renders the full search card (standard ref + citation addresses). */
export type ChatSearchResultCard = SearchResultCard;

export type ChatSearchResultMessage = ChatMessageBase & {
  type: 'search-result';
  query: string;
  summary?: string;
  cards: ChatSearchResultCard[];
  /** What the LLM (or fallback tokenizer) extracted from the query. */
  expanded?: {
    tokens: string[];
    productCategory?: string;
    parameters?: Record<string, string>;
  };
};

export type ChatMessage =
  | ChatSystemMessage
  | ChatUserTextMessage
  | ChatUserFileMessage
  | ChatInspectionMessage
  | ChatJobMessage
  | ChatSearchResultMessage;
