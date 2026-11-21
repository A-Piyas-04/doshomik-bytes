import { PAPER_STATUSES, type PaperStatus } from '@doshomik/shared';
import { sql } from 'kysely';
import { jsonBuildObject } from 'kysely/helpers/postgres';
import { db } from '../../db';
import { fullText } from '../../db/search';
import { found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { assertUserExists } from '../users/users.service';

/** A paper as lists show it, with the viewer's tracker status (null if not saved). */
export function selectPaperCards(viewerId: number) {
  return db
    .selectFrom('papers as p')
    .innerJoin('fields as f', 'f.id', 'p.field_id')
    .select((eb) => [
      'p.id',
      'p.title',
      'p.authors',
      'p.year',
      'p.created_at',
      jsonBuildObject({ id: eb.ref('f.id'), name: eb.ref('f.name') }).as('field'),
      eb
        .selectFrom('user_papers as mine')
        .whereRef('mine.paper_id', '=', 'p.id')
        .where('mine.user_id', '=', viewerId)
        .select('mine.status')
        .as('my_status'),
    ]);
}

export function listFields() {
  return db.selectFrom('fields').select(['id', 'name', 'description']).orderBy('name').execute();
}

export function listPapers(viewerId: number, filter: { fieldId?: number; q?: string }, page: PageQuery) {
  const query = selectPaperCards(viewerId)
    .$if(filter.fieldId !== undefined, (qb) => qb.where('p.field_id', '=', filter.fieldId!))
    .$if(filter.q !== undefined, (qb) => qb.where(fullText.paper('p', filter.q!)));
  return fetchPage(query, 'p', page);
}

/** The full structured summary. The PDF itself is never hosted; `paper_url` links to the original. */
export async function getPaper(viewerId: number, paperId: number) {
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
    ])
    .where('p.id', '=', paperId)
    .executeTakeFirst();
  return found(paper, 'Paper');
}

/**
 * Learn first: the paper's prerequisite topics in order, each with the learn items tagged
 * with it. A topic with no items still appears, so the app can show its name and summary.
 */
export async function getLearnFirst(paperId: number) {
  await assertPaperExists(paperId);

  const rows = await db
    .selectFrom('paper_prerequisites as pp')
    .innerJoin('topics as t', 't.id', 'pp.topic_id')
    .leftJoin('learn_items as li', 'li.topic_id', 't.id')
    .select(['t.id as topic_id', 't.name', 't.summary', 'li.id as item_id', 'li.title', 'li.kind', 'li.media_url'])
    .where('pp.paper_id', '=', paperId)
    .orderBy('pp.position')
    .orderBy('t.id')
    .orderBy('li.id')
    .execute();

  type LearnFirstItem = { id: number; title: string; kind: string; media_url: string | null };
  const topics = new Map<number, { id: number; name: string; summary: string | null; learn_items: LearnFirstItem[] }>();
  for (const row of rows) {
    let topic = topics.get(row.topic_id);
    if (!topic) {
      topic = { id: row.topic_id, name: row.name, summary: row.summary, learn_items: [] };
      topics.set(row.topic_id, topic);
    }
    if (row.item_id !== null) {
      topic.learn_items.push({ id: row.item_id, title: row.title!, kind: row.kind!, media_url: row.media_url });
    }
  }

  const list = [...topics.values()];
  return {
    topic_count: list.length,
    topics_with_learn_items: list.filter((topic) => topic.learn_items.length > 0).length,
    topics: list,
  };
}

/** Save (status "saved"), or move along the tracker to "reading" and "completed". */
export async function setPaperStatus(userId: number, paperId: number, status: PaperStatus) {
  await assertPaperExists(paperId);
  return db
    .insertInto('user_papers')
    .values({ user_id: userId, paper_id: paperId, status })
    .onConflict((oc) => oc.columns(['user_id', 'paper_id']).doUpdateSet({ status, updated_at: sql`now()` }))
    .returning(['paper_id', 'status', 'updated_at'])
    .executeTakeFirstOrThrow();
}

export async function removePaperStatus(userId: number, paperId: number): Promise<void> {
  await db.deleteFrom('user_papers').where('user_id', '=', userId).where('paper_id', '=', paperId).execute();
}

/** A user's tracker for their profile, grouped into saved, reading and completed. */
export async function getReadingTracker(viewerId: number, userId: number) {
  await assertUserExists(userId);
  const rows = await selectPaperCards(viewerId)
    .innerJoin('user_papers as tracked', 'tracked.paper_id', 'p.id')
    .where('tracked.user_id', '=', userId)
    .select(['tracked.status', 'tracked.updated_at'])
    .orderBy('tracked.updated_at', 'desc')
    .execute();
  return Object.fromEntries(PAPER_STATUSES.map((status) => [status, rows.filter((row) => row.status === status)])) as Record<
    PaperStatus,
    typeof rows
  >;
}

/** A field's starting roadmap: papers in reading order, each with a note on why it comes here. */
export async function getRoadmap(viewerId: number, fieldId: number) {
  const field = found(
    await db.selectFrom('fields').select(['id', 'name', 'description']).where('id', '=', fieldId).executeTakeFirst(),
    'Field',
  );
  const rows = await selectPaperCards(viewerId)
    .innerJoin('roadmap_steps as rs', 'rs.paper_id', 'p.id')
    .where('rs.field_id', '=', fieldId)
    .select(['rs.position', 'rs.note'])
    .orderBy('rs.position')
    .execute();
  return { field, steps: rows.map(({ position, note, ...paper }) => ({ position, note, paper })) };
}

async function assertPaperExists(paperId: number): Promise<void> {
  found(await db.selectFrom('papers').select('id').where('id', '=', paperId).executeTakeFirst(), 'Paper');
}
