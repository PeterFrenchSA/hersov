export interface SemanticSearchFilters {
  country?: string;
  tag?: string;
  importedBatchId?: string;
}

export interface BuiltSemanticSearchQuery {
  sql: string;
  params: unknown[];
}

export interface RawSemanticSearchRow {
  contact_id: string;
  full_name: string;
  current_title: string | null;
  company_name: string | null;
  location_country: string | null;
  preview_snippet: string | null;
  distance: number | string;
}

export function buildSemanticSearchQuery(input: {
  vectorLiteral: string;
  k: number;
  filters?: SemanticSearchFilters;
}): BuiltSemanticSearchQuery {
  const safeK = Math.max(1, Math.min(50, Math.floor(input.k)));
  const params: unknown[] = [input.vectorLiteral, safeK];
  const conditions: string[] = ["e.kind = 'profile'"];

  const filters = input.filters;
  if (filters?.country) {
    params.push(filters.country);
    conditions.push(`c.location_country ILIKE $${params.length}`);
  }

  if (filters?.importedBatchId) {
    params.push(filters.importedBatchId);
    conditions.push(`c.source_import_batch_id = $${params.length}::uuid`);
  }

  if (filters?.tag) {
    params.push(filters.tag);
    const tagParamIndex = params.length;
    conditions.push(`EXISTS (
      SELECT 1
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
        AND (ct.tag_id = $${tagParamIndex} OR t.name ILIKE $${tagParamIndex})
    )`);
  }

  const sql = `
    SELECT
      c.id AS contact_id,
      c.full_name,
      c.current_title,
      co.name AS company_name,
      c.location_country,
      LEFT(COALESCE(e.text, ''), 180) AS preview_snippet,
      (e.vector <=> $1::vector) AS distance
    FROM embeddings e
    JOIN contacts c ON c.id = e.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.vector <=> $1::vector
    LIMIT $2
  `;

  return {
    sql,
    params,
  };
}

export function distanceToScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const score = 1 - value;
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}
