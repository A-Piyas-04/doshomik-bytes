import { db } from '../../db';
import { containsPattern, fullText, fuzzy, similarity } from '../../db/search';
import { selectPosts } from '../posts/posts.service';
import { selectPaperCards } from '../research/research.service';

export const SEARCH_TYPES = ['users', 'posts', 'topics', 'learn_items', 'courses', 'papers'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

type Searcher = (q: string, viewerId: number, limit: number) => Promise<unknown[]>;

const searchers: Record<SearchType, Searcher> = {
  users: (q, _viewerId, limit) =>
    db
      .selectFrom('users as u')
      .select(['u.id', 'u.username', 'u.display_name', 'u.avatar_url'])
      .where((eb) => eb.or([fuzzy('u', 'username', q), eb('u.display_name', 'ilike', containsPattern(q))]))
      .orderBy(similarity('u', 'username', q), 'desc')
      .limit(limit)
      .execute(),

  posts: (q, viewerId, limit) =>
    selectPosts(viewerId).where(fullText.post('p', q)).orderBy('p.created_at', 'desc').limit(limit).execute(),

  topics: (q, _viewerId, limit) =>
    db
      .selectFrom('topics as t')
      .select(['t.id', 't.name', 't.summary'])
      .where(fuzzy('t', 'name', q))
      .orderBy(similarity('t', 'name', q), 'desc')
      .limit(limit)
      .execute(),

  learn_items: (q, _viewerId, limit) =>
    db
      .selectFrom('learn_items as li')
      .select(['li.id', 'li.topic_id', 'li.title', 'li.kind', 'li.media_url', 'li.duration_seconds'])
      .where(fullText.learnItem('li', q))
      .orderBy('li.created_at', 'desc')
      .limit(limit)
      .execute(),

  courses: (q, _viewerId, limit) =>
    db
      .selectFrom('courses as c')
      .select(['c.id', 'c.title', 'c.description', 'c.thumbnail_url', 'c.external_url'])
      .where(fullText.course('c', q))
      .orderBy('c.created_at', 'desc')
      .limit(limit)
      .execute(),

  papers: (q, viewerId, limit) =>
    selectPaperCards(viewerId).where(fullText.paper('p', q)).orderBy('p.created_at', 'desc').limit(limit).execute(),
};

/** One search box: the top matches of each type, grouped. Pass `types` to fetch only some ("See all"). */
export async function search(viewerId: number, q: string, limit: number, types: readonly SearchType[] = SEARCH_TYPES) {
  const groups = await Promise.all(types.map(async (type) => [type, await searchers[type](q, viewerId, limit)] as const));
  return Object.fromEntries(groups) as Partial<Record<SearchType, unknown[]>>;
}
