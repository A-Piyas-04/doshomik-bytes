import { sql, type RawBuilder, type SelectQueryBuilder } from 'kysely';
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
    const parsed = JSON.parse(json) as unknown[];
    const [createdAt, id] = parsed;
    // A rank cursor (fetchRankedPage) has three parts; it is not valid here.
    if (parsed.length === 2 && typeof createdAt === 'string' && Number.isInteger(id)) return [createdAt, id as number];
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

/**
 * Keyset pagination on a numeric rank, smallest first, then the internal id: for lists ordered
 * by a score instead of time (the Research collection by trend rank). `rank` must be the same
 * expression as the index it should use.
 */
export async function fetchRankedPage<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  keys: { rank: RawBuilder<number>; id: string },
  page: PageQuery,
): Promise<Page<O>> {
  const id = sql.ref(keys.id);
  let paged = query.select([sql<number>`${keys.rank}`.as('_cursor_rank'), sql<number>`${id}`.as('_cursor_id')]);
  if (page.cursor) {
    const json = decrypt('cursor', page.cursor);
    const parsed = json ? (JSON.parse(json) as unknown[]) : [];
    if (parsed[0] !== 'rank' || !Number.isInteger(parsed[1]) || !Number.isInteger(parsed[2])) {
      throw badRequest('Invalid cursor', 'INVALID_CURSOR');
    }
    paged = paged.where(sql<boolean>`(${keys.rank}, ${id}) > (${parsed[1]}, ${parsed[2]})`);
  }

  const rows = (await paged
    .orderBy(keys.rank)
    .orderBy(id)
    .limit(page.limit + 1)
    .execute()) as unknown as (O & { _cursor_rank: number; _cursor_id: number })[];

  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(({ _cursor_rank: _, _cursor_id: __, ...item }) => item as unknown as O),
    next_cursor: rows.length > page.limit && last ? encrypt('cursor', JSON.stringify(['rank', last._cursor_rank, last._cursor_id])) : null,
  };
}

/** Applies `map` to every item of a page. */
export function mapPage<T, R>(page: Page<T>, map: (item: T) => R): Page<R> {
  return { items: page.items.map(map), next_cursor: page.next_cursor };
}
