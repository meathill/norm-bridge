# NormBridge TECH SPEC v0.1

## 1. Overview

NormBridge is a local-first Electron application that converts technical standard PDFs into auditable structured schemas, stores normalized data in SQLite, and uses deterministic queries plus AI-assisted extraction to generate traceable product compliance reports.

The technical design follows the product principle:

> AI may help compile documents into structured data, but every report claim must be traceable to source files and citations.

## 2. Target Stack

### 2.1 Desktop Runtime

- Electron
- Vite
- TypeScript

### 2.2 Frontend

- React
- TailwindCSS
- coss ui
- Zustand

### 2.3 Local Data

- SQLite
- JSON / JSONL artifacts
- Local filesystem project directory

### 2.4 AI Orchestration

- OpenAI Agents SDK
- Tool-based local functions for parsing, validation, database writes, and report generation

### 2.5 Document Processing

Document processing is a first-class subsystem. NormBridge must extract traceable structure from both technical-standard PDFs and common Office documents.

Required input families:

- PDF standards and evidence documents.
- Excel workbooks used as product lists, BOMs, quotations, and sales sheets.
- Word documents used as product specifications, certificates, test reports, and report templates.
- PowerPoint files are not a v0.1 priority, but the parser interface should not prevent future support.

Required extraction capabilities:

- Text extraction.
- Page or sheet structure extraction.
- Table extraction.
- Image/OCR fallback when needed.
- Source position tracking.
- Structured artifact generation.

The exact libraries can be selected during implementation after testing against real standards PDFs.

## 3. Architecture

```txt
Electron App
  Main Process
    Project filesystem service
    SQLite service
    Agent runner service
    Document processing workers
    Report generation service

  Renderer Process
    React UI
    Zustand stores
    Project explorer
    PDF/schema review UI
    Product matching UI
    Report export UI

Local Project Directory
  sources/
  artifacts/
  db/
  review/
  reports/
```

## 4. Process Responsibilities

### 4.1 Electron Main Process

The main process owns all privileged local operations:

- Read/write project files.
- Create project directory structure.
- Calculate file hashes.
- Run SQLite queries and migrations.
- Start AI Agent jobs.
- Run PDF, Excel, and Office extraction tasks.
- Generate reports.
- Expose safe IPC APIs to the renderer.

Renderer code must not directly write project files or access SQLite.

### 4.2 Electron Renderer Process

The renderer owns UI and user interaction:

- Project selection.
- Drag-and-drop file import.
- Job progress display.
- Schema review and editing.
- Product matching review.
- Report preview and export actions.

### 4.3 Worker Layer

Long-running tasks should run outside the renderer thread:

- PDF extraction.
- Office document extraction.
- OCR.
- Table extraction.
- Agent jobs.
- SQLite import.
- Report export.

Implementation options:

- Node worker threads.
- Child processes.
- Electron utility process.

v0.1 may start with worker threads unless a specific library requires child processes.

## 5. Local Project Layout

Each user project is a self-contained directory.

```txt
project/
  normbridge.project.json

  sources/
    standards/
    inputs/
    evidence/
      certificates/
      test-reports/
      product-specs/

  artifacts/
    standards/
    inputs/
    evidence/
    jobs/

  db/
    normbridge.sqlite

  review/
    human-overrides.jsonl
    audit-log.jsonl
    unresolved-items.json

  reports/
```

## 6. Document Processing Subsystem

Document parsing and extraction is central to NormBridge. The system must treat every extracted fact as a value with provenance, not just text.

### 6.1 Supported Document Types

v0.1 target support:

```txt
Standards:
  .pdf

Product inputs:
  .xlsx
  .xls
  .csv

Evidence and product documents:
  .pdf
  .docx
  .xlsx

Report outputs:
  .xlsx
  .docx
  .pdf
```

Legacy `.doc` and `.ppt/.pptx` files are not required for v0.1, but may be added through the same adapter model.

### 6.2 Parser Adapter Interface

Each parser should implement a common interface.

```ts
type DocumentParser = {
  supports(input: { mimeType?: string; extension: string }): boolean;
  inspect(input: { filePath: string }): Promise<DocumentInspection>;
  extract(input: DocumentExtractInput): Promise<DocumentExtractResult>;
};

type DocumentInspection = {
  sourceId: string;
  documentKind: "pdf" | "workbook" | "word" | "csv" | "unknown";
  isEncrypted?: boolean;
  hasTextLayer?: boolean;
  pageCount?: number;
  sheetCount?: number;
  needsOcr?: boolean;
  warnings: string[];
};

type DocumentExtractInput = {
  sourceId: string;
  filePath: string;
  mode: "standard_index" | "product_input" | "evidence" | "report_template";
};

type DocumentExtractResult = {
  sourceId: string;
  artifacts: ExtractedArtifactRef[];
  warnings: ExtractionWarning[];
};
```

### 6.3 PDF Extraction

PDF extraction must support two use cases:

- Technical standards that become structured standard indexes.
- Evidence documents such as certificates, test reports, and product specifications.

Required PDF artifacts:

```txt
source-metadata.json
pages.json
text-blocks.json
tables.json
images.json
ocr.json
citations.json
```

Required PDF extraction fields:

- Page number.
- Text blocks.
- Reading order.
- Font/size hints when available.
- Bounding boxes when available.
- Tables and table cells.
- Images or scanned regions.
- OCR confidence when OCR is used.
- Extraction warnings.

PDF-specific requirements:

- Preserve original file hash.
- Preserve page-level source references.
- Keep enough coordinates or offsets to display the source location in review UI.
- Detect encrypted PDFs and fail with a reviewable error.
- Detect missing text layer and route to OCR.
- Mark cross-page tables and complex layout as review items.

### 6.4 Office Workbook Extraction

Workbook extraction is required for Excel product lists, BOMs, quotations, and compliance matrices.

Required workbook artifacts:

```txt
source-metadata.json
workbook-structure.json
sheets.json
tables.json
detected-product-tables.json
extracted-products.json
cell-citations.json
```

Required workbook extraction fields:

- Workbook metadata.
- Sheet names.
- Used ranges.
- Cell values.
- Formulas when present.
- Merged ranges.
- Header row candidates.
- Product row candidates.
- Cell addresses.
- Table boundaries.

Workbook-specific requirements:

- Preserve sheet name and cell reference for every extracted product attribute.
- Preserve formulas separately from calculated/display values when possible.
- Do not silently flatten merged cells without recording the merge.
- Support manual correction of detected header rows and product tables.
- Treat every product attribute as reviewable if confidence is low.

### 6.5 Word Document Extraction

Word extraction is required for product specifications, certificate text, test reports, and future report templates.

Required Word artifacts:

```txt
source-metadata.json
document-structure.json
paragraphs.json
tables.json
images.json
extracted-evidence.json
citations.json
```

Required Word extraction fields:

- Paragraph text.
- Headings.
- Tables and cells.
- Inline images metadata.
- Section order.
- Page references when available or render-derived.
- Evidence candidates such as certificate numbers, standards, test methods, product models, dates, and issuing organizations.

Word-specific requirements:

- Preserve paragraph/table position.
- Preserve source quote for extracted evidence.
- Mark ambiguous evidence fields as review items.
- Allow evidence extracted from Word files to be linked to product match results.

### 6.6 Evidence Document Extraction

Evidence documents include certificates, test reports, product specifications, datasheets, and customer-provided technical files.

Evidence extraction should produce:

```ts
type EvidenceCandidate = {
  id: string;
  sourceId: string;
  evidenceType:
    | "certificate"
    | "test_report"
    | "product_spec"
    | "datasheet"
    | "unknown";
  productModel?: string;
  standardCode?: string;
  certificateNo?: string;
  testMethod?: string;
  issueDate?: string;
  expiryDate?: string;
  issuer?: string;
  citationIds: string[];
  confidence: number;
  reviewStatus: "unreviewed" | "verified" | "rejected" | "needs_review";
};
```

v0.1 may keep evidence matching simple, but the document pipeline must preserve enough provenance for later certification-path features.

### 6.7 Extraction Quality Levels

Every extraction result should carry a quality level:

```txt
exact
high_confidence
low_confidence
needs_ocr
needs_review
failed
```

The UI should surface low-confidence and failed extraction results as review items instead of hiding them.

### 6.8 Parser Selection

Parser libraries should be selected by real document evaluation.

Evaluation criteria:

- Text extraction accuracy.
- Table extraction accuracy.
- Position/citation fidelity.
- Performance on large PDFs.
- OCR compatibility.
- Cross-platform behavior in Electron.
- License compatibility.
- Ability to run locally.

## 7. Project Config

File: `normbridge.project.json`

```json
{
  "schemaVersion": "0.1",
  "projectId": "proj_...",
  "name": "UAE Low Voltage Standards",
  "createdAt": "2026-05-18T00:00:00.000Z",
  "updatedAt": "2026-05-18T00:00:00.000Z",
  "defaultLocale": "en",
  "agentProfile": "standard-index-v0.1",
  "dbPath": "db/normbridge.sqlite"
}
```

## 8. Artifact Strategy

SQLite is the query layer, not the only source of truth.

Every major step writes an artifact before or alongside database writes:

```txt
artifacts/
  standards/
    standard_<id>/
      source-metadata.json
      pages.json
      text-blocks.json
      tables.json
      clauses.json
      requirements.json
      references.json
      citations.json
      standard-schema.v0.1.json

  inputs/
    input_<id>/
      source-metadata.json
      workbook-structure.json
      extracted-products.json

  evidence/
    evidence_<id>/
      source-metadata.json
      document-structure.json
      extracted-evidence.json
      citations.json

  jobs/
    job_<id>/
      plan.json
      events.jsonl
      query-results.json
      citation-gate.json
```

Artifacts are designed for:

- Auditability.
- Debugging.
- Human review.
- Rebuilding SQLite.
- Git or file-sync workflows.

## 9. Source Identity

Every imported file receives a source record.

```ts
type SourceFile = {
  id: string;
  kind:
    | "standard_pdf"
    | "excel_input"
    | "certificate"
    | "test_report"
    | "product_spec"
    | "datasheet"
    | "report_template";
  originalName: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  mimeType?: string;
};
```

The file hash is used to detect changes and preserve citation integrity.

## 10. Citation Model

All reportable facts must be connected to citations.

```ts
type Citation = {
  id: string;
  sourceId: string;
  sourceHash: string;
  page?: number;
  sheetName?: string;
  cellRef?: string;
  paragraphIndex?: number;
  tableIndex?: number;
  clauseNo?: string;
  textStart?: number;
  textEnd?: number;
  bbox?: [number, number, number, number];
  quote: string;
};
```

Rules:

- A `Requirement` must have at least one citation before it can be used as report evidence.
- A `MatchResult` must reference both standard citations and product input source positions when available.
- Reports cannot export formal claims without citations.

## 11. SQLite Schema v0.1

The database schema is intentionally conservative and can evolve after real document testing.

### 11.1 Tables

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  mime_type TEXT
);

CREATE TABLE standards (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT,
  country_or_region TEXT,
  version TEXT,
  publication_date TEXT,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE clauses (
  id TEXT PRIMARY KEY,
  standard_id TEXT NOT NULL,
  parent_clause_id TEXT,
  clause_no TEXT,
  title TEXT,
  page_start INTEGER,
  page_end INTEGER,
  raw_text TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  FOREIGN KEY (standard_id) REFERENCES standards(id),
  FOREIGN KEY (parent_clause_id) REFERENCES clauses(id)
);

CREATE TABLE citations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  page INTEGER,
  sheet_name TEXT,
  cell_ref TEXT,
  paragraph_index INTEGER,
  table_index INTEGER,
  clause_no TEXT,
  text_start INTEGER,
  text_end INTEGER,
  bbox_json TEXT,
  quote TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  standard_id TEXT NOT NULL,
  clause_id TEXT,
  subject TEXT,
  applies_to TEXT,
  condition_text TEXT,
  requirement_text TEXT NOT NULL,
  parameter_name TEXT,
  operator TEXT,
  value_text TEXT,
  unit TEXT,
  test_method TEXT,
  evidence_required TEXT,
  severity TEXT,
  confidence REAL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  FOREIGN KEY (standard_id) REFERENCES standards(id),
  FOREIGN KEY (clause_id) REFERENCES clauses(id)
);

CREATE TABLE requirement_citations (
  requirement_id TEXT NOT NULL,
  citation_id TEXT NOT NULL,
  PRIMARY KEY (requirement_id, citation_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id),
  FOREIGN KEY (citation_id) REFERENCES citations(id)
);

CREATE TABLE standard_references (
  id TEXT PRIMARY KEY,
  from_standard_id TEXT NOT NULL,
  from_clause_id TEXT,
  referenced_standard_code TEXT NOT NULL,
  referenced_clause TEXT,
  relation_type TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  FOREIGN KEY (from_standard_id) REFERENCES standards(id),
  FOREIGN KEY (from_clause_id) REFERENCES clauses(id)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  display_name TEXT,
  model TEXT,
  row_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value_text TEXT NOT NULL,
  unit TEXT,
  sheet_name TEXT,
  cell_ref TEXT,
  confidence REAL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  product_model TEXT,
  standard_code TEXT,
  certificate_no TEXT,
  test_method TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  issuer TEXT,
  confidence REAL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE evidence_citations (
  evidence_id TEXT NOT NULL,
  citation_id TEXT NOT NULL,
  PRIMARY KEY (evidence_id, citation_id),
  FOREIGN KEY (evidence_id) REFERENCES evidence_items(id),
  FOREIGN KEY (citation_id) REFERENCES citations(id)
);

CREATE TABLE match_results (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  requirement_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id)
);

CREATE TABLE match_citations (
  match_result_id TEXT NOT NULL,
  citation_id TEXT NOT NULL,
  PRIMARY KEY (match_result_id, citation_id),
  FOREIGN KEY (match_result_id) REFERENCES match_results(id),
  FOREIGN KEY (citation_id) REFERENCES citations(id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
```

### 11.2 Match Status Values

```txt
quote_ready
quote_ready_with_limits
missing_evidence
needs_review
not_applicable
conflict
unknown
```

## 12. IPC API

Renderer calls main process through typed IPC wrappers.

### 12.1 Project APIs

```ts
type ProjectApi = {
  createProject(input: { directory: string; name: string }): Promise<ProjectInfo>;
  openProject(input: { directory: string }): Promise<ProjectInfo>;
  getProjectStatus(): Promise<ProjectStatus>;
};
```

### 12.2 Import APIs

```ts
type ImportApi = {
  importStandardPdf(input: { filePath: string }): Promise<ImportResult>;
  importWorkbook(input: { filePath: string }): Promise<ImportResult>;
  importEvidenceDocument(input: {
    filePath: string;
    evidenceKind?: "certificate" | "test_report" | "product_spec" | "datasheet";
  }): Promise<ImportResult>;
};
```

### 12.3 Job APIs

```ts
type JobApi = {
  startStandardIndexJob(input: { sourceId: string }): Promise<JobInfo>;
  startProductMatchJob(input: { inputSourceId: string }): Promise<JobInfo>;
  startEvidenceExtractionJob(input: { sourceId: string }): Promise<JobInfo>;
  getJob(input: { jobId: string }): Promise<JobInfo>;
  subscribeJobEvents(input: { jobId: string }): AsyncIterable<JobEvent>;
};
```

### 12.4 Review APIs

```ts
type ReviewApi = {
  listReviewItems(input: { status?: string }): Promise<ReviewItem[]>;
  updateReviewItem(input: ReviewUpdate): Promise<void>;
  applyOverride(input: HumanOverride): Promise<void>;
};
```

### 12.5 Report APIs

```ts
type ReportApi = {
  runCitationGate(input: { jobId: string }): Promise<CitationGateResult>;
  exportComplianceMatrix(input: { jobId: string; format: "xlsx" }): Promise<ExportResult>;
  exportReport(input: { jobId: string; format: "docx" | "pdf" }): Promise<ExportResult>;
};
```

## 13. Frontend State

Use Zustand for app state that is shared across screens.

Suggested stores:

```txt
useProjectStore
  currentProject
  projectStatus
  openProject()
  refreshProject()

useJobStore
  jobs
  activeJobId
  jobEvents
  startJob()
  subscribeJob()

useReviewStore
  reviewItems
  filters
  updateReviewItem()

useSelectionStore
  selectedSourceId
  selectedClauseId
  selectedRequirementId
  selectedProductId
```

Server-like data should be refetched from the main process instead of treated as permanent renderer truth.

## 14. UI Screens

### 14.1 Project Home

- Open/create project.
- Show project health.
- Show standards, input files, reports, active jobs.

### 14.2 Standard Import

- Drag-and-drop PDF.
- Show imported file metadata.
- Show PDF inspection result, including text layer, encryption, OCR need, and page count.
- Start indexing job.

### 14.3 Standard Review

- Left: clause tree.
- Center: PDF/page/text/table preview.
- Right: extracted requirements and citations.
- Review actions:
  - confirm
  - edit
  - mark needs review
  - ignore

### 14.4 Reference Graph

- Show referenced standards.
- Show unresolved references.
- Show candidate equivalence or adoption relationships as unverified items.

### 14.5 Product Input Review

- Show workbook sheets.
- Show detected tables, merged cells, formulas, and header row candidates.
- Show extracted product rows.
- Show extracted product attributes with cell references.
- Allow manual correction.

### 14.6 Evidence Review

- Show imported evidence documents.
- Show extracted certificate numbers, product models, standard codes, dates, issuers, and test methods.
- Link extracted evidence to PDF pages, Word paragraphs, tables, or workbook cells.
- Allow manual correction.

### 14.7 Match Results

- Product list.
- Match status summary.
- Requirement-level evidence.
- Missing evidence list.
- Link each result to standard citation, product input cell, and evidence document citation when available.

### 14.8 Report Export

- Show citation gate result.
- Block export if formal claims lack citations.
- Export matrix/report.

## 15. Agent Pipeline

### 15.1 Standard Index Job

```txt
1. Register source file
2. Inspect PDF
3. Extract PDF pages/text/tables/images/OCR
4. Build page, text, table, and citation artifacts
5. Agent analyzes document structure
6. Clause compiler creates clause tree
7. Requirement extractor creates candidate requirements
8. Reference resolver creates standard references
9. Validator checks schema integrity
10. Write artifacts
11. Import to SQLite
12. Create review items
```

### 15.2 Evidence Extraction Job

```txt
1. Register evidence source file
2. Inspect document type
3. Extract text, tables, images, and source positions
4. Identify evidence candidates
5. Generate citations
6. Validate evidence artifacts
7. Import evidence records to SQLite
8. Create review items
```

### 15.3 Product Match Job

```txt
1. Register workbook source
2. Extract workbook structure
3. Detect product table
4. Extract product rows and attributes
5. Write product artifacts
6. Import products to SQLite
7. Query applicable requirements
8. Query available evidence
9. Run deterministic matching rules
10. Generate match results
11. Run citation gate
12. Prepare report data
```

## 16. Validation Rules

### 16.1 Schema Validation

Before writing to SQLite:

- IDs must be stable and unique.
- Source hashes must match imported files.
- Clauses must reference existing standards.
- Requirements must reference existing standards.
- Reviewed requirements used for reports must have citations.
- Citations must include source id, source hash, and quote.
- Product attributes must preserve workbook sheet/cell references when extracted from spreadsheets.
- Evidence items must preserve citations before being used as supporting proof.

### 16.2 Report Validation

Before export:

- Every formal result must have standard citation.
- Product-specific claims should have product source location.
- Evidence-backed claims should have evidence document citations.
- `quote_ready` cannot be emitted without supporting citations.
- `unknown` and `needs_review` may be emitted without final citations if they clearly state what is missing.

## 17. Audit Log

All human and automated changes that affect report output should be logged.

```ts
type AuditEvent = {
  id: string;
  eventType: string;
  actor: "system" | "agent" | "user";
  targetType?: string;
  targetId?: string;
  payload: unknown;
  createdAt: string;
};
```

Examples:

- file_imported
- document_extracted
- standard_index_job_started
- requirement_extracted
- evidence_extracted
- requirement_reviewed
- human_override_applied
- product_attribute_corrected
- match_result_generated
- report_exported

## 18. Security and Privacy

v0.1 assumptions:

- User files remain local.
- Project data is stored in the user-selected directory.
- No automatic cloud sync.
- AI API calls may send selected extracted text to the configured model provider.

Required safeguards:

- Show clear setting for AI provider/API usage.
- Avoid sending entire project directory by default.
- Send only the page/chunk needed for current extraction step.
- Store model, prompt version, and extraction job metadata.
- Do not upload files except through explicit AI processing steps.

## 19. Error Handling

Common failure cases:

- PDF is encrypted.
- PDF has no text layer.
- Office file is password-protected.
- Office file contains unsupported legacy binary content.
- OCR fails or is unavailable.
- Table extraction is incomplete.
- Workbook header detection is ambiguous.
- Agent output fails schema validation.
- SQLite migration fails.
- Source file hash changed after import.
- Report citation gate fails.

Required behavior:

- Keep partial artifacts.
- Mark job as failed or needs review.
- Show actionable error message.
- Never silently continue with broken citation chains.

## 20. Testing Strategy

### 20.1 Unit Tests

- Schema validation.
- Citation validation.
- SQLite migrations.
- Match status transitions.
- Unit conversion and numeric comparison helpers.
- Document parser adapter selection.
- Workbook cell citation generation.
- Evidence citation validation.

### 20.2 Integration Tests

- Import sample PDF.
- Generate schema artifact.
- Rebuild SQLite from artifact.
- Import sample Excel.
- Import sample Word product spec or certificate.
- Extract evidence candidates.
- Generate match results.
- Run citation gate.

### 20.3 Golden Fixtures

Maintain small fixtures:

```txt
fixtures/
  standards/
    simple-standard.pdf
    simple-standard.expected-schema.json
  inputs/
    simple-products.xlsx
    simple-products.expected-products.json
  evidence/
    simple-certificate.docx
    simple-certificate.expected-evidence.json
  reports/
    simple-match.expected.json
```

### 20.4 Manual QA

Use at least one real target-country standard PDF, one real sales Excel template, and one real certificate/test report/product spec before considering v0.1 complete.

## 21. MVP Milestones

### Milestone 1: Project Shell

- Electron app starts.
- Create/open project directory.
- Basic navigation and Zustand stores.
- SQLite initialized.

### Milestone 2: Standard Import

- Drag PDF.
- Register source.
- Extract text/pages.
- Show extracted content.

### Milestone 3: Schema Compiler

- Generate clause tree.
- Generate citations.
- Generate candidate requirements.
- Write artifacts and SQLite rows.

### Milestone 4: Review UI

- Review clause/requirement/citation.
- Apply human overrides.
- Write audit events.

### Milestone 5: Office and Evidence Import

- Import workbook.
- Extract products.
- Import Word/PDF evidence document.
- Extract evidence candidates.
- Show source positions and citations.

### Milestone 6: Matching

- Query requirements.
- Query evidence.
- Generate match results.

### Milestone 7: Report Export

- Run citation gate.
- Export compliance matrix.
- Export report draft.

## 22. Open Questions

- Does `coss ui` refer to a specific component library, or should it be treated as the project UI kit name?
- Which PDF extraction library performs best on the target standard documents?
- Will v0.1 require OCR, or can initial testing start with text-layer PDFs?
- Which Excel templates should be considered canonical for MVP?
- Which Office document types are mandatory for the first customer workflow: `.docx`, `.xlsx`, `.pdf`, or all three?
- Which certificate/test report/product spec samples should be used to validate evidence extraction?
- What is the first target market and product category for validation?
- What level of manual review is acceptable before a schema is marked usable?
