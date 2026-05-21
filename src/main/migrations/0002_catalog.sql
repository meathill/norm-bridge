-- 0002_catalog.sql
-- Standard registry (the "category" layer) + an explicit category tree, plus the
-- product-spec → required-standards relationship. See decision log: referenced
-- standards (e.g. ISO 19650) become first-class catalog entries even without a PDF.

CREATE TABLE standard_catalog (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT,
  issuing_body TEXT,
  -- 'imported' = we have the PDF and compiled it; 'referenced' = only cited by another standard.
  origin TEXT NOT NULL,
  standard_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (standard_id) REFERENCES standards(id)
);

CREATE UNIQUE INDEX idx_catalog_code ON standard_catalog(code);
CREATE INDEX idx_catalog_body ON standard_catalog(issuing_body);
CREATE INDEX idx_catalog_origin ON standard_catalog(origin);
CREATE INDEX idx_catalog_standard ON standard_catalog(standard_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  -- 'issuing_body' | 'csi_division' | 'domain'
  kind TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE UNIQUE INDEX idx_categories_kind_code ON categories(kind, code);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE standard_categories (
  standard_catalog_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (standard_catalog_id, category_id),
  FOREIGN KEY (standard_catalog_id) REFERENCES standard_catalog(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE product_required_standards (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  standard_catalog_id TEXT NOT NULL,
  requirement_note TEXT,
  -- 'extracted' from a product doc, or 'manual' entry.
  source TEXT NOT NULL DEFAULT 'extracted',
  confidence REAL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (standard_catalog_id) REFERENCES standard_catalog(id)
);

CREATE INDEX idx_prs_product ON product_required_standards(product_id);
CREATE INDEX idx_prs_catalog ON product_required_standards(standard_catalog_id);

CREATE TABLE product_categories (
  product_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (product_id, category_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Upgrade the free-text reference to a navigable catalog link (kept alongside the code).
ALTER TABLE standard_references ADD COLUMN referenced_catalog_id TEXT REFERENCES standard_catalog(id);
