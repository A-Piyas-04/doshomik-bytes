import { sql, type RawBuilder } from 'kysely';

// Search conditions. Each full-text expression must stay identical to its index in
// migration 001, or Postgres cannot use the index.

type Condition = RawBuilder<boolean>;

const query = (q: string) => sql`websearch_to_tsquery('english', ${q})`;
const col = (table: string, column: string) => sql.ref(`${table}.${column}`);

export const fullText = {
  post: (t: string, q: string): Condition =>
    sql`to_tsvector('english', coalesce(${col(t, 'caption')}, '')) @@ ${query(q)}`,
  learnItem: (t: string, q: string): Condition =>
    sql`to_tsvector('english', ${col(t, 'title')} || ' ' || coalesce(${col(t, 'body')}, '')) @@ ${query(q)}`,
  course: (t: string, q: string): Condition =>
    sql`to_tsvector('english', ${col(t, 'title')} || ' ' || coalesce(${col(t, 'description')}, '')) @@ ${query(q)}`,
  paper: (t: string, q: string): Condition =>
    sql`to_tsvector('english', ${col(t, 'title')} || ' ' || coalesce(${col(t, 'main_idea')}, '')) @@ ${query(q)}`,
};

/**
 * Typo-tolerant match on a trigram-indexed column (users.username, topics.name):
 * similar words via pg_trgm's `%`, or a plain substring.
 */
export function fuzzy(table: string, column: string, q: string): Condition {
  const ref = col(table, column);
  return sql`(${ref} % ${q} OR ${ref} ILIKE ${containsPattern(q)})`;
}

export function similarity(table: string, column: string, q: string) {
  return sql<number>`similarity(${col(table, column)}, ${q})`;
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (char) => `\\${char}`);

/** `%q%` for ILIKE, with q's own wildcards escaped. */
export const containsPattern = (q: string) => `%${escapeLike(q)}%`;

/** `q%` for ILIKE: starts with q. */
export const startsWithPattern = (q: string) => `${escapeLike(q)}%`;
