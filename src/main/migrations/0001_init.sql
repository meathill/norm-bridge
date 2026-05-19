-- 0001_init.sql
-- TECH_SPEC §11.1 — v0.1 baseline schema.
-- All review_status defaults to 'unreviewed' so the citation gate forces explicit confirmation.

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

CREATE UNIQUE INDEX idx_sources_sha256 ON sources(sha256);
CREATE INDEX idx_sources_kind ON sources(kind);

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

CREATE INDEX idx_standards_source ON standards(source_id);

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

CREATE INDEX idx_clauses_standard ON clauses(standard_id);
CREATE INDEX idx_clauses_parent ON clauses(parent_clause_id);
CREATE INDEX idx_clauses_review ON clauses(review_status);

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

CREATE INDEX idx_citations_source ON citations(source_id);

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

CREATE INDEX idx_requirements_standard ON requirements(standard_id);
CREATE INDEX idx_requirements_clause ON requirements(clause_id);
CREATE INDEX idx_requirements_review ON requirements(review_status);

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

CREATE INDEX idx_std_refs_from ON standard_references(from_standard_id);
CREATE INDEX idx_std_refs_code ON standard_references(referenced_standard_code);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  display_name TEXT,
  model TEXT,
  row_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_products_source ON products(source_id);

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

CREATE INDEX idx_product_attrs_product ON product_attributes(product_id);

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

CREATE INDEX idx_evidence_source ON evidence_items(source_id);
CREATE INDEX idx_evidence_standard_code ON evidence_items(standard_code);

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

CREATE INDEX idx_match_results_product ON match_results(product_id);
CREATE INDEX idx_match_results_status ON match_results(status);

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

CREATE INDEX idx_audit_events_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_target ON audit_events(target_type, target_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at);
