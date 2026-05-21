import { newId } from '@shared/ids';
import type { CatalogOrigin, CategoryKind } from '@shared/domain/catalog';
import type {
  ClauseRecord,
  StandardRecord,
  StandardReferenceRecord,
} from '@shared/domain/standard-schema';
import { csiDivision, normalizeStandardCode, parseIssuingBody } from '@main/parsers/standard-code';
import type { SqliteService } from './sqlite-service';

export type CatalogSyncInput = {
  standard: StandardRecord;
  clauses: ClauseRecord[];
  references: StandardReferenceRecord[];
};

export type CatalogSyncResult = {
  importedCatalogId: string;
  referencedCount: number;
  categoryCount: number;
};

/**
 * Populates the standard registry + category tree from a freshly compiled
 * standard. Idempotent on code: re-running upgrades a 'referenced' entry to
 * 'imported' if we later import its PDF.
 */
export class CatalogService {
  constructor(private readonly sqlite: SqliteService) {}

  sync(input: CatalogSyncInput): CatalogSyncResult {
    return this.sqlite.tx(() => {
      const now = new Date().toISOString();
      const categoryCache = new Map<string, string>(); // `${kind}:${code}` -> id

      // 1. The imported standard itself.
      const importedCode = normalizeStandardCode(input.standard.title ?? input.standard.id);
      const importedCatalogId = this.upsertCatalog({
        code: importedCode,
        title: input.standard.title,
        issuingBody: parseIssuingBody(importedCode),
        origin: 'imported',
        standardId: input.standard.id,
        now,
      });

      // 2. Classify the imported standard by the CSI divisions of its clauses.
      const divisions = new Map<string, string>();
      for (const c of input.clauses) {
        if (!c.clauseNo) continue;
        const div = csiDivision(c.clauseNo);
        if (div) divisions.set(div.code, div.name);
      }
      for (const [code, name] of divisions) {
        const categoryId = this.upsertCategory('csi_division', code, name, now, categoryCache);
        this.linkStandardCategory(importedCatalogId, categoryId);
      }
      const importedBody = parseIssuingBody(importedCode);
      if (importedBody) {
        const categoryId = this.upsertCategory(
          'issuing_body',
          importedBody,
          importedBody,
          now,
          categoryCache,
        );
        this.linkStandardCategory(importedCatalogId, categoryId);
      }

      // 3. Referenced standards become catalog entries; link the FK + classify.
      const updateRef = this.sqlite.prepare(
        'UPDATE standard_references SET referenced_catalog_id = ? WHERE id = ?',
      );
      let referencedCount = 0;
      for (const ref of input.references) {
        const code = normalizeStandardCode(ref.referencedStandardCode);
        if (!code) continue;
        const body = parseIssuingBody(code);
        const catalogId = this.upsertCatalog({
          code,
          issuingBody: body,
          origin: 'referenced',
          now,
        });
        updateRef.run(catalogId, ref.id);
        referencedCount += 1;

        if (body) {
          const categoryId = this.upsertCategory('issuing_body', body, body, now, categoryCache);
          this.linkStandardCategory(catalogId, categoryId);
        }
        const div = csiDivision(code);
        if (div) {
          const categoryId = this.upsertCategory(
            'csi_division',
            div.code,
            div.name,
            now,
            categoryCache,
          );
          this.linkStandardCategory(catalogId, categoryId);
        }
      }

      return {
        importedCatalogId,
        referencedCount,
        categoryCount: categoryCache.size,
      };
    });
  }

  private upsertCatalog(entry: {
    code: string;
    title?: string;
    issuingBody?: string;
    origin: CatalogOrigin;
    standardId?: string;
    now: string;
  }): string {
    const existing = this.sqlite
      .prepare('SELECT id, origin FROM standard_catalog WHERE code = ?')
      .get(entry.code) as { id: string; origin: CatalogOrigin } | undefined;

    if (existing) {
      // Upgrade a previously-referenced entry once we actually import its PDF.
      if (entry.origin === 'imported' && existing.origin !== 'imported') {
        this.sqlite
          .prepare(
            'UPDATE standard_catalog SET origin = ?, standard_id = ?, title = COALESCE(?, title), issuing_body = COALESCE(?, issuing_body) WHERE id = ?',
          )
          .run(
            'imported',
            entry.standardId ?? null,
            entry.title ?? null,
            entry.issuingBody ?? null,
            existing.id,
          );
      }
      return existing.id;
    }

    const id = newId('catalog');
    this.sqlite
      .prepare(
        `INSERT INTO standard_catalog (id, code, title, issuing_body, origin, standard_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.code,
        entry.title ?? null,
        entry.issuingBody ?? null,
        entry.origin,
        entry.standardId ?? null,
        entry.now,
      );
    return id;
  }

  private upsertCategory(
    kind: CategoryKind,
    code: string,
    name: string,
    now: string,
    cache: Map<string, string>,
  ): string {
    const key = `${kind}:${code}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const existing = this.sqlite
      .prepare('SELECT id FROM categories WHERE kind = ? AND code = ?')
      .get(kind, code) as { id: string } | undefined;
    if (existing) {
      cache.set(key, existing.id);
      return existing.id;
    }

    const id = newId('category');
    this.sqlite
      .prepare(
        'INSERT INTO categories (id, parent_id, kind, code, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, null, kind, code, name, now);
    cache.set(key, id);
    return id;
  }

  private linkStandardCategory(catalogId: string, categoryId: string): void {
    this.sqlite
      .prepare(
        'INSERT OR IGNORE INTO standard_categories (standard_catalog_id, category_id) VALUES (?, ?)',
      )
      .run(catalogId, categoryId);
  }
}
