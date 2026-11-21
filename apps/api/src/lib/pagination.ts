import { sql, type SelectQueryBuilder } from 'kysely';
import { z } from 'zod';
import { badRequest } from './errors';

// Keyset pagination on (created_at, id). The cursor carries created_at as Postgres text
// so it keeps microsecond precision, which a JS Date would lose.

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

interface Cursor {
  createdAt: string;
  id: number;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof createdAt === 'string' && Number.isInteger(id)) return { createdAt, id };
  } catch {
    // fall through
  }
  throw badRequest('Invalid cursor', 'INVALID_CURSOR');
}

/**
 * Runs `query` for one page. `table` is the alias whose created_at and id define the order.
 * The query must select `${table}.id` as `id`.
 */
export async function fetchPage<DB, TB extends keyof DB, O extends { id: number }>(
  query: SelectQueryBuilder<DB, TB, O>,
  table: string,
  page: PageQuery,
  order: 'asc' | 'desc' = 'desc',
): Promise<Page<O>> {
  const createdAt = sql.ref(`${table}.created_at`);
  const id = sql.ref(`${table}.id`);
  const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;

  let paged = query.select(sql<string>`${createdAt}::text`.as('cursor_ts'));
  if (cursor) {
    const operator = sql.raw(order === 'desc' ? '<' : '>');
    paged = paged.where(sql<boolean>`(${createdAt}, ${id}) ${operator} (${cursor.createdAt}::timestamptz, ${cursor.id})`);
  }

  // Kysely can't infer the added column on a generic query, so state the row type.
  const rows = (await paged
    .orderBy(createdAt, order)
    .orderBy(id, order)
    .limit(page.limit + 1)
    .execute()) as unknown as (O & { cursor_ts: string })[];

  const pageRows = rows.slice(0, page.limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(({ cursor_ts: _, ...item }) => item as unknown as O),
    next_cursor: rows.length > page.limit && last ? encodeCursor({ createdAt: last.cursor_ts, id: last.id }) : null,
  };
}
