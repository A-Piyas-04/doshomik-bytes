import { PAPER_STATUSES, type PaperStatus } from '@doshomik/shared';
import { sql } from 'kysely';
import { env } from '../../config/env';
import { db } from '../../db';
import { fullText } from '../../db/search';
import { canSeeContentOf, isPublished } from '../../db/visibility';
import { found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { MEDIA_COLUMNS, mediaView } from '../media/media.service';
import { visibleUserId } from '../users/users.service';

/** Published papers as lists show them, with the viewer's tracker status (null if not saved). */
export function selectPaperCards(viewerId: number) {
  return db
    .selectFrom('papers as p')
    .innerJoin('fields as f', 'f.id', 'p.field_id')
    .where(isPublished('p'))
    .select((eb) => [
      'p.public_id as id',
      'p.title',
      'p.authors',
      'p.year',
      'p.created_at',
      sql<{ slug: string; name: string }>`json_build_object('slug', f.slug, 'name', f.name)`.as('field'),
      sql<string>`${env.PUBLIC_URL} || '/papers/' || p.public_id`.as('share_url'),
      eb
        .selectFrom('user_papers as mine')
        .whereRef('mine.paper_id', '=', 'p.id')
        .where('mine.user_id', '=', viewerId)
        .select('mine.status')
        .as('my_status'),
    ]);
}

export function listFields() {
  return db.selectFrom('fields').select(['slug', 'name', 'description']).orderBy('name').execute();
}

/** `interests: true` keeps papers in the fields the viewer picked at onboarding. */
export function listPapers(viewerId: number, filter: { field?: string; q?: string; interests?: boolean }, page: PageQuery) {
  const query = selectPaperCards(viewerId)
    .$if(filter.field !== undefined, (qb) => qb.where('f.slug', '=', filter.field!))
    .$if(filter.q !== undefined, (qb) => qb.where(fullText.paper('p', filter.q!)))
    .$if(filter.interests === true, (qb) =>
      qb.where('p.field_id', 'in', (eb) => eb.selectFrom('user_fields').select('field_id').where('user_id', '=', viewerId)),
    );
  return fetchPage(query, 'p', page);
}

/** The full structured summary. The PDF itself is never hosted; `paper_url` links to the original. */
export async function getPaper(viewerId: number, paperPublicId: string) {
  const paper = await selectPaperCards(viewerId)
    .select([
      'p.paper_url',
      'p.research_questions',
      'p.main_idea',
      'p.data_source',
      'p.method_steps',
      'p.results',
      'p.figures',
      'p.limitations',
      'p.evaluation',
      'p.published_at',
    ])
    .where('p.public_id', '=', paperPublicId)
    .executeTakeFirst();
  return found(paper, 'Paper');
}

/**
 * Learn first: the paper's prerequisite topics in order, each with its published learn items.
 * A topic with no items still appears, so the app can show its name and summary.
 */
export async function getLearnFirst(paperPublicId: string) {
  const paperId = await publishedPaperId(paperPublicId);

  const rows = await db
    .selectFrom('paper_prerequisites as pp')
    .innerJoin('topics as t', 't.id', 'pp.topic_id')
    .leftJoin('learn_items as li', (join) => join.onRef('li.topic_id', '=', 't.id').on('li.status', '=', 'published'))
    .leftJoin('media_assets as m', 'm.id', 'li.media_id')
    .select(['t.id as topic_id', 't.slug', 't.name', 't.summary', 'li.public_id as item_id', 'li.title', 'li.kind', 'li.media_url', ...MEDIA_COLUMNS])
    .where('pp.paper_id', '=', paperId)
    .orderBy('pp.position')
    .orderBy('t.id')
    .orderBy('li.id')
    .execute();

  type Item = { id: string; title: string; kind: string; media: ReturnType<typeof mediaView>; media_url: string | null };
  const topics = new Map<number, { slug: string; name: string; summary: string | null; learn_items: Item[] }>();
  for (const row of rows) {
    let topic = topics.get(row.topic_id);
    if (!topic) {
      topic = { slug: row.slug, name: row.name, summary: row.summary, learn_items: [] };
      topics.set(row.topic_id, topic);
    }
    if (row.item_id !== null) {
      topic.learn_items.push({
        id: row.item_id,
        title: row.title!,
        kind: row.kind!,
        media: mediaView(row, { private: false }),
        media_url: row.media_url,
      });
    }
  }

  const list = [...topics.values()];
  return {
    topic_count: list.length,
    topics_with_learn_items: list.filter((topic) => topic.learn_items.length > 0).length,
    topics: list,
  };
}

/**
 * "Papers like this one": published papers ranked by how many Learn first topics they share,
 * then same field, then newest. Semantic similarity replaces this when Elasticsearch arrives.
 */
export async function getRelatedPapers(viewerId: number, paperPublicId: string, limit: number) {
  const paper = found(
    await db.selectFrom('papers as p').select(['p.id', 'p.field_id']).where('p.public_id', '=', paperPublicId).where(isPublished('p')).executeTakeFirst(),
    'Paper',
  );
  const sharedTopics = sql<number>`(
    SELECT count(*)::int FROM paper_prerequisites a
    JOIN paper_prerequisites b ON b.topic_id = a.topic_id
    WHERE a.paper_id = ${paper.id} AND b.paper_id = p.id
  )`;
  return selectPaperCards(viewerId)
    .select(sharedTopics.as('shared_topics'))
    .where('p.id', '!=', paper.id)
    .where((eb) => eb.or([eb(sharedTopics, '>', 0), eb('p.field_id', '=', paper.field_id)]))
    .orderBy(sharedTopics, 'desc')
    .orderBy(sql`p.field_id = ${paper.field_id}`, 'desc')
    .orderBy('p.created_at', 'desc')
    .limit(limit)
    .execute();
}

/** Save (status "saved"), or move along the tracker to "reading" and "completed". */
export async function setPaperStatus(userId: number, paperPublicId: string, status: PaperStatus) {
  const paperId = await publishedPaperId(paperPublicId);
  const row = await db
    .insertInto('user_papers')
    .values({ user_id: userId, paper_id: paperId, status })
    .onConflict((oc) => oc.columns(['user_id', 'paper_id']).doUpdateSet({ status, updated_at: sql`now()` }))
    .returning(['status', 'updated_at'])
    .executeTakeFirstOrThrow();
  return { paper_id: paperPublicId, ...row };
}

export async function removePaperStatus(userId: number, paperPublicId: string): Promise<void> {
  await db
    .deleteFrom('user_papers')
    .where('user_id', '=', userId)
    .where('paper_id', '=', (eb) => eb.selectFrom('papers').select('id').where('public_id', '=', paperPublicId))
    .execute();
}

/**
 * A user's tracker for their profile, grouped by status. Like their posts, a private account's
 * tracker is empty to anyone but accepted followers.
 */
export async function getReadingTracker(viewerId: number, userPublicId: string) {
  const ownerId = await visibleUserId(viewerId, userPublicId);
  const rows = await selectPaperCards(viewerId)
    .innerJoin('user_papers as tracked', 'tracked.paper_id', 'p.id')
    .innerJoin('users as owner', 'owner.id', 'tracked.user_id')
    .where('tracked.user_id', '=', ownerId)
    .where(canSeeContentOf(viewerId, 'owner'))
    .select(['tracked.status', 'tracked.updated_at'])
    .orderBy('tracked.updated_at', 'desc')
    .execute();
  return Object.fromEntries(PAPER_STATUSES.map((status) => [status, rows.filter((row) => row.status === status)])) as Record<
    PaperStatus,
    typeof rows
  >;
}

/** A field's starting roadmap: published papers in reading order, numbered 1..n, each with a note. */
export async function getRoadmap(viewerId: number, fieldSlug: string) {
  const field = found(
    await db.selectFrom('fields').select(['id', 'slug', 'name', 'description']).where('slug', '=', fieldSlug).executeTakeFirst(),
    'Field',
  );
  const rows = await selectPaperCards(viewerId)
    .innerJoin('roadmap_steps as rs', 'rs.paper_id', 'p.id')
    .where('rs.field_id', '=', field.id)
    .select('rs.note')
    .orderBy('rs.position')
    .execute();
  const { id: _, ...publicField } = field;
  return { field: publicField, steps: rows.map(({ note, ...paper }, index) => ({ step: index + 1, note, paper })) };
}

async function publishedPaperId(paperPublicId: string): Promise<number> {
  const paper = await db.selectFrom('papers as p').select('p.id').where('p.public_id', '=', paperPublicId).where(isPublished('p')).executeTakeFirst();
  return found(paper, 'Paper').id;
}
