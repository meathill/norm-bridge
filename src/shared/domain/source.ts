export type SourceKind =
  | 'standard_pdf'
  | 'excel_input'
  | 'certificate'
  | 'test_report'
  | 'product_spec'
  | 'datasheet'
  | 'report_template';

export type SourceFile = {
  id: string;
  kind: SourceKind;
  originalName: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  mimeType?: string;
};
