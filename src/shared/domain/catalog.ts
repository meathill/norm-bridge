/**
 * The standard registry (a "category-like" layer): every standard code we know
 * about, whether we imported its PDF or only saw it referenced by another
 * standard. Plus an explicit category tree that classifies catalog entries and
 * products.
 */

export type CatalogOrigin = 'imported' | 'referenced';

export type StandardCatalogEntry = {
  id: string;
  code: string;
  title?: string;
  issuingBody?: string;
  origin: CatalogOrigin;
  standardId?: string;
  createdAt: string;
};

export type CategoryKind = 'issuing_body' | 'csi_division' | 'domain';

export type Category = {
  id: string;
  parentId?: string;
  kind: CategoryKind;
  code?: string;
  name: string;
  createdAt: string;
};

export type ProductRequiredStandard = {
  id: string;
  productId: string;
  standardCatalogId: string;
  requirementNote?: string;
  source: 'extracted' | 'manual';
  confidence?: number;
  reviewStatus: 'unreviewed' | 'verified' | 'rejected' | 'needs_review';
  createdAt: string;
};
