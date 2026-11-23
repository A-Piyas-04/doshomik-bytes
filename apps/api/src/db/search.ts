import { sql, type RawBuilder } from 'kysely';
import type { Db } from '.';

// Search conditions. Each full-text expression must stay identical to its index in
// migration 001, or Postgres cannot use the index.

type Condition = RawBuilder<boolean>;

const query = (q: string) => sql`websearch_to_tsquery('english', ${q})`;
const col = (table: string, column: string) => sql.ref(`${table}.${column}`);

/** A paper query in both languages: English stemming, or the 'bangla' configuration (migration 005). */
const paperQuery = (q: string) => sql`(websearch_to_tsquery('english', ${q}) || websearch_to_tsquery('bangla', ${q}))`;

export const fullText = {
  post: (t: string, q: string): Condition =>
    sql`to_tsvector('english', coalesce(${col(t, 'caption')}, '')) @@ ${query(q)}`,
  learnItem: (t: string, q: string): Condition =>
    sql`to_tsvector('english', ${col(t, 'title')} || ' ' || coalesce(${col(t, 'body')}, '')) @@ ${query(q)}`,
  course: (t: string, q: string): Condition =>
    sql`to_tsvector('english', ${col(t, 'title')} || ' ' || coalesce(${col(t, 'description')}, '')) @@ ${query(q)}`,
  /**
   * Title, authors and the Paper Card question in English and Bangla, through the stored
   * papers.search_vector (papers_search_idx). A Bangla query finds an English-titled paper
   * through its Bangla card.
   */
  paper: (t: string, q: string): Condition => sql`${col(t, 'search_vector')} @@ ${paperQuery(q)}`,
};

/** Relevance of a paper for `q`, for ordering search results. */
export const paperRank = (t: string, q: string) => sql<number>`ts_rank(${col(t, 'search_vector')}, ${paperQuery(q)})`;

/**
 * Rebuilds a paper's search document. Call it in the same transaction as any change to the paper's
 * title, authors or main idea, or to its Paper Cards. The expression lives in one SQL function
 * (refresh_paper_search, migration 005), so the backfill and the app can't disagree.
 */
export async function refreshPaperSearch(trx: Db, paperId: number): Promise<void> {
  await sql`SELECT refresh_paper_search(${paperId})`.execute(trx);
}

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
