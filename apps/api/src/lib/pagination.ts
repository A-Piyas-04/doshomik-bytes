import { sql, type SelectQueryBuilder } from 'kysely';
import { z } from 'zod';
import { decrypt, encrypt } from './crypto';
import { badRequest } from './errors';

// Keyset pagination on (created_at, internal id). The cursor is encrypted, so clients can't
// read the internal ids inside it. created_at travels as Postgres text to keep microseconds,
// which a JS Date would lose.

export const pageQuery = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Columns that order a list: an alias (meaning alias.created_at and alias.id) or explicit columns. */
export type PageKeys = string | { createdAt: string; id: string };

type CursorColumns = { _cursor_ts: string; _cursor_id: number };

function decodeCursor(value: string): [string, number] {
  const json = decrypt('cursor', value);
  if (json) {
    const [createdAt, id] = JSON.parse(json) as unknown[];
    if (typeof createdAt === 'string' && Number.isInteger(id)) return [createdAt, id as number];
  }
  throw badRequest('Invalid cursor', 'INVALID_CURSOR');
}

/** Runs `query` for one page, newest first by default. */
export async function fetchPage<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  keys: PageKeys,
  page: PageQuery,
  order: 'asc' | 'desc' = 'desc',
): Promise<Page<O>> {
  const columns = typeof keys === 'string' ? { createdAt: `${keys}.created_at`, id: `${keys}.id` } : keys;
  const createdAt = sql.ref(columns.createdAt);
  const id = sql.ref(columns.id);

  let paged = query.select([sql<string>`${createdAt}::text`.as('_cursor_ts'), sql<number>`${id}`.as('_cursor_id')]);
  if (page.cursor) {
    const [cursorTs, cursorId] = decodeCursor(page.cursor);
    const operator = sql.raw(order === 'desc' ? '<' : '>');
    paged = paged.where(sql<boolean>`(${createdAt}, ${id}) ${operator} (${cursorTs}::timestamptz, ${cursorId})`);
  }

  // Kysely can't infer the added columns on a generic query, so state the row type.
  const rows = (await paged
    .orderBy(createdAt, order)
    .orderBy(id, order)
    .limit(page.limit + 1)
    .execute()) as unknown as (O & CursorColumns)[];

  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(({ _cursor_ts: _, _cursor_id: __, ...item }) => item as unknown as O),
    next_cursor:
      rows.length > page.limit && last ? encrypt('cursor', JSON.stringify([last._cursor_ts, last._cursor_id])) : null,
  };
}

/** Applies `map` to every item of a page. */
export function mapPage<T, R>(page: Page<T>, map: (item: T) => R): Page<R> {
  return { items: page.items.map(map), next_cursor: page.next_cursor };
}
