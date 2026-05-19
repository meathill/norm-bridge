import type { DocumentInspection } from './inspection';
import type { SourceFile } from './source';

export type ImportResult = {
  source: SourceFile;
  inspection: DocumentInspection;
  alreadyExisted: boolean;
};
