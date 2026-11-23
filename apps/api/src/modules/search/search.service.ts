import { sql } from 'kysely';
import { db } from '../../db';
import { containsPattern, fullText, fuzzy, paperRank, similarity, startsWithPattern } from '../../db/search';
import { canSeeProfile, isPublished, isSearchablePost } from '../../db/visibility';
import { topicRef } from '../learn/learn.service';
import { selectPosts, toPost } from '../posts/posts.service';
import { selectPaperCards } from '../research/research.service';

// Search runs on Postgres (pg_trgm + full-text indexes) until Elasticsearch is installed. Every
// group applies the visibility rules: no blocked or inactive users, no private or deleted posts,
// no drafts. See docs/prototype-2-implementation-notes.md for the Elasticsearch plan.

export const SEARCH_TYPES = ['users', 'posts', 'topics', 'learn_items', 'courses', 'papers'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

type Searcher = (q: string, viewerId: number, limit: number) => Promise<unknown[]>;

const searchers: Record<SearchType, Searcher> = {
  users: (q, viewerId, limit) =>
    db
      .selectFrom('users as u')
      .select(['u.public_id as id', 'u.username', 'u.display_name', 'u.avatar_url', 'u.is_private'])
      .where(canSeeProfile(viewerId, 'u'))
      .where((eb) => eb.or([fuzzy('u', 'username', q), eb('u.display_name', 'ilike', containsPattern(q))]))
      .orderBy(similarity('u', 'username', q), 'desc')
      .limit(limit)
      .execute(),

  posts: async (q, viewerId, limit) =>
    (
      await selectPosts(viewerId)
        .where(isSearchablePost(viewerId, 'p', 'u'))
        .where(fullText.post('p', q))
        .orderBy('p.created_at', 'desc')
        .limit(limit)
        .execute()
    ).map(toPost),

  topics: (q, _viewerId, limit) =>
    db
      .selectFrom('topics as t')
      .select(['t.slug', 't.name', 't.summary'])
      .where(fuzzy('t', 'name', q))
      .orderBy(similarity('t', 'name', q), 'desc')
      .limit(limit)
      .execute(),

  learn_items: (q, _viewerId, limit) =>
    db
      .selectFrom('learn_items as li')
      .leftJoin('topics as t', 't.id', 'li.topic_id')
      .select(['li.public_id as id', topicRef('t').as('topic'), 'li.title', 'li.kind'])
      .where(isPublished('li'))
      .where(fullText.learnItem('li', q))
      .orderBy('li.created_at', 'desc')
      .limit(limit)
      .execute(),

  courses: (q, _viewerId, limit) =>
    db
      .selectFrom('courses as c')
      .select(['c.public_id as id', 'c.title', 'c.description', 'c.thumbnail_url', 'c.external_url'])
      .where(isPublished('c'))
      .where(fullText.course('c', q))
      .orderBy('c.created_at', 'desc')
      .limit(limit)
      .execute(),

  papers: (q, viewerId, limit) =>
    // Title, authors and the card question in English and Bangla (papers.search_vector), best match first.
    selectPaperCards(viewerId).where(fullText.paper('p', q)).orderBy(paperRank('p', q), 'desc').orderBy('p.id', 'desc').limit(limit).execute(),
};

/** One search box: the top matches of each type, grouped. Pass `types` to fetch only some ("See all"). */
export async function search(viewerId: number, q: string, limit: number, types: readonly SearchType[] = SEARCH_TYPES) {
  const groups = await Promise.all(types.map(async (type) => [type, await searchers[type](q, viewerId, limit)] as const));
  return Object.fromEntries(groups) as Partial<Record<SearchType, unknown[]>>;
}

export interface Suggestion {
  type: 'user' | 'topic' | 'paper' | 'course';
  /** Public id, or the slug for topics. */
  id: string;
  label: string;
}

/**
 * Autocomplete while typing: a few names and titles that start with (or contain) the text.
 * The app calls it 250 ms after the last keystroke, from 2 characters.
 */
export async function suggest(viewerId: number, q: string): Promise<Suggestion[]> {
  const prefix = startsWithPattern(q);
  const contains = containsPattern(q);
  const [users, topics, papers, courses] = await Promise.all([
    db
      .selectFrom('users as u')
      .select(['u.public_id as id', 'u.username as label'])
      .where(canSeeProfile(viewerId, 'u'))
      .where('u.username', 'ilike', prefix)
      .orderBy(sql`length(u.username)`)
      .limit(3)
      .execute(),
    db
      .selectFrom('topics as t')
      .select(['t.slug as id', 't.name as label'])
      .where((eb) => eb.or([eb('t.name', 'ilike', prefix), fuzzy('t', 'name', q)]))
      .orderBy(similarity('t', 'name', q), 'desc')
      .limit(3)
      .execute(),
    db.selectFrom('papers as p').select(['p.public_id as id', 'p.title as label']).where(isPublished('p')).where('p.title', 'ilike', contains).limit(3).execute(),
    db.selectFrom('courses as c').select(['c.public_id as id', 'c.title as label']).where(isPublished('c')).where('c.title', 'ilike', contains).limit(2).execute(),
  ]);
  return [
    ...topics.map((s) => ({ type: 'topic' as const, ...s })),
    ...papers.map((s) => ({ type: 'paper' as const, ...s })),
    ...courses.map((s) => ({ type: 'course' as const, ...s })),
    ...users.map((s) => ({ type: 'user' as const, ...s })),
  ].slice(0, 8);
}
