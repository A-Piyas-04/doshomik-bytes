import { sql } from 'kysely';
import { env } from '../../config/env';
import { db } from '../../db';
import { isPublished } from '../../db/visibility';
import { badRequest, found } from '../../lib/errors';
import { fetchPage, mapPage, type PageQuery } from '../../lib/pagination';
import { MEDIA_COLUMNS, mediaView, type MediaColumns } from '../media/media.service';

/**
 * `{ slug, name, field }` of the topic aliased `t`, or null when the item has no topic. `field` is
 * the slug of the topic's learn area (or null), so clients can colour posts and lessons by area.
 */
export const topicRef = (t: string) =>
  sql<{ slug: string; name: string; field: string | null } | null>`CASE WHEN ${sql.ref(`${t}.id`)} IS NULL THEN NULL
    ELSE json_build_object('slug', ${sql.ref(`${t}.slug`)}, 'name', ${sql.ref(`${t}.name`)},
      'field', (SELECT f.slug FROM fields f WHERE f.id = ${sql.ref(`${t}.field_id`)})) END`;

/** `{ slug, name }` of the field (learn area) aliased `f`, or null when there is none. */
export const fieldRef = (f: string) =>
  sql<{ slug: string; name: string } | null>`CASE WHEN ${sql.ref(`${f}.id`)} IS NULL THEN NULL
    ELSE json_build_object('slug', ${sql.ref(`${f}.slug`)}, 'name', ${sql.ref(`${f}.name`)}) END`;

/**
 * Keeps rows whose topic (aliased `t`) belongs to the learn area with this field slug. Learn
 * items, questions, quizzes and tagged posts reach their area through their topic (migration 007).
 */
export const inArea = (t: string, fieldSlug: string) =>
  sql<boolean>`${sql.ref(`${t}.field_id`)} = (SELECT id FROM fields WHERE slug = ${fieldSlug})`;

/** Published learn items with their topic and media. */
function selectLearnItems() {
  return db
    .selectFrom('learn_items as li')
    .leftJoin('topics as t', 't.id', 'li.topic_id')
    .leftJoin('media_assets as m', 'm.id', 'li.media_id')
    .where(isPublished('li'))
    .select([
      'li.public_id as id',
      topicRef('t').as('topic'),
      'li.title',
      'li.kind',
      'li.body',
      'li.media_url',
      'li.duration_seconds',
      'li.created_at',
      ...MEDIA_COLUMNS,
    ]);
}

type LearnItemRow = MediaColumns & {
  id: string;
  topic: { slug: string; name: string; field: string | null } | null;
  title: string;
  kind: string;
  body: string | null;
  media_url: string | null;
  duration_seconds: number | null;
  created_at: Date;
};

/**
 * A learn item. `media` is a file from the upload pipeline; `media_url` is an outside link
 * the team pasted instead. An item has at most one of them.
 */
export function toLearnItem(row: LearnItemRow) {
  const media = mediaView(row, { private: false });
  return {
    id: row.id,
    topic: row.topic,
    title: row.title,
    kind: row.kind,
    body: row.body,
    media,
    media_url: row.media_url,
    duration_seconds: media?.duration_seconds ?? row.duration_seconds,
    created_at: row.created_at,
  };
}

/** Topics with their learn area. */
function selectTopics() {
  return db
    .selectFrom('topics as t')
    .leftJoin('fields as f', 'f.id', 't.field_id')
    .select(['t.id', 't.slug', 't.name', 't.summary', fieldRef('f').as('field')]);
}

/** Every topic, or one learn area's, by name. */
export async function listTopics(filter: { field?: string } = {}) {
  const rows = await selectTopics()
    .$if(filter.field !== undefined, (qb) => qb.where('f.slug', '=', filter.field!))
    .orderBy('t.name')
    .execute();
  return rows.map(({ id: _, ...topic }) => topic);
}

export async function getTopic(slug: string) {
  const topic = found(await selectTopics().where('t.slug', '=', slug).executeTakeFirst(), 'Topic');
  const items = await selectLearnItems().where('li.topic_id', '=', topic.id).orderBy('li.id').execute();
  const { id: _, ...publicTopic } = topic;
  return { ...publicTopic, learn_items: items.map(toLearnItem) };
}

export async function listLearnItems(filter: { topic?: string; field?: string }, page: PageQuery) {
  const query = selectLearnItems()
    .$if(filter.topic !== undefined, (qb) => qb.where('t.slug', '=', filter.topic!))
    .$if(filter.field !== undefined, (qb) => qb.where(inArea('t', filter.field!)));
  return mapPage(await fetchPage(query, 'li', page), toLearnItem);
}

export async function getLearnItem(itemPublicId: string) {
  return toLearnItem(found(await selectLearnItems().where('li.public_id', '=', itemPublicId).executeTakeFirst(), 'Learn item'));
}

/** Published courses (ours and external cards), with the viewer's progress. */
function selectCourses(viewerId: number) {
  return db
    .selectFrom('courses as c')
    .leftJoin('course_progress as cp', (join) => join.onRef('cp.course_id', '=', 'c.id').on('cp.user_id', '=', viewerId))
    .leftJoin('fields as cf', 'cf.id', 'c.field_id')
    .where(isPublished('c'))
    .select((eb) => [
      'c.public_id as id',
      'c.title',
      'c.description',
      'c.thumbnail_url',
      'c.external_url',
      fieldRef('cf').as('field'),
      'c.created_at',
      sql<string>`${env.PUBLIC_URL} || '/courses/' || c.public_id`.as('share_url'),
      eb
        .selectFrom('course_items as ci')
        .innerJoin('learn_items as li', 'li.id', 'ci.item_id')
        .whereRef('ci.course_id', '=', 'c.id')
        .where(isPublished('li'))
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('item_count'),
      sql<{ last_position: number; completed_at: string | null } | null>`CASE WHEN cp.user_id IS NULL THEN NULL
        ELSE json_build_object('last_position', cp.last_position, 'completed_at', cp.completed_at) END`.as('my_progress'),
    ]);
}

/** Published courses, optionally one learn area's. */
export function listCourses(viewerId: number, filter: { field?: string }, page: PageQuery) {
  const query = selectCourses(viewerId).$if(filter.field !== undefined, (qb) => qb.where('cf.slug', '=', filter.field!));
  return fetchPage(query, 'c', page);
}

/** Courses the viewer has started, most recent first: "continue where you left off". */
export function listMyCourses(viewerId: number, page: PageQuery) {
  const query = selectCourses(viewerId).where('cp.user_id', '=', viewerId);
  return fetchPage(query, { createdAt: 'cp.updated_at', id: 'c.id' }, page);
}

/** A course with its published learn items in step order. */
export async function getCourse(viewerId: number, coursePublicId: string) {
  const course = found(await selectCourses(viewerId).where('c.public_id', '=', coursePublicId).executeTakeFirst(), 'Course');
  const items = await selectLearnItems()
    .innerJoin('course_items as ci', 'ci.item_id', 'li.id')
    .innerJoin('courses as c', 'c.id', 'ci.course_id')
    .where('c.public_id', '=', coursePublicId)
    .select('ci.position')
    .orderBy('ci.position')
    .execute();
  // Steps are numbered 1..n over the published items, so drafts don't leave gaps.
  return { ...course, items: items.map((row, index) => ({ step: index + 1, ...toLearnItem(row) })) };
}

/** Records the step the viewer reached. Reaching the last step marks the course completed. */
export async function saveProgress(viewerId: number, coursePublicId: string, lastPosition: number) {
  const course = await getCourse(viewerId, coursePublicId);
  if (course.external_url) throw badRequest('External courses have no steps to track', 'EXTERNAL_COURSE');
  const steps = course.item_count ?? 0;
  if (lastPosition > steps) throw badRequest(`This course has ${steps} steps`);

  const courseId = (await db.selectFrom('courses').select('id').where('public_id', '=', coursePublicId).executeTakeFirstOrThrow()).id;
  const completed = steps > 0 && lastPosition === steps;
  const progress = await db
    .insertInto('course_progress')
    .values({ user_id: viewerId, course_id: courseId, last_position: lastPosition, completed_at: completed ? new Date() : null })
    .onConflict((oc) =>
      oc.columns(['user_id', 'course_id']).doUpdateSet({
        last_position: lastPosition,
        updated_at: new Date(),
        // Keep the first completion time; finishing again doesn't reset it.
        completed_at: completed ? sql`coalesce(course_progress.completed_at, now())` : sql`course_progress.completed_at`,
      }),
    )
    .returning(['last_position', 'completed_at', 'updated_at'])
    .executeTakeFirstOrThrow();

  // The steps reached count as completed lessons, for Learn before reading (they stay completed
  // if the user later moves back in the course).
  const reached = course.items.filter((item) => item.step <= lastPosition).map((item) => item.id);
  if (reached.length) {
    await sql`
      INSERT INTO learn_item_completions (user_id, learn_item_id)
      SELECT ${viewerId}, id FROM learn_items WHERE public_id IN (${sql.join(reached)})
      ON CONFLICT DO NOTHING`.execute(db);
  }
  return progress;
}

// ---------- Learn before reading (A13) ----------

/** "I already know this": the topic counts as done in every paper's Learn first list. */
export async function markTopicKnown(userId: number, topicSlug: string): Promise<void> {
  const topic = found(await db.selectFrom('topics').select('id').where('slug', '=', topicSlug).executeTakeFirst(), 'Topic');
  await db.insertInto('user_known_topics').values({ user_id: userId, topic_id: topic.id }).onConflict((oc) => oc.doNothing()).execute();
}

export async function unmarkTopicKnown(userId: number, topicSlug: string): Promise<void> {
  await db
    .deleteFrom('user_known_topics')
    .where('user_id', '=', userId)
    .where('topic_id', '=', (eb) => eb.selectFrom('topics').select('id').where('slug', '=', topicSlug))
    .execute();
}

/** Marks a published lesson or note as completed, wherever it was opened. */
export async function completeLearnItem(userId: number, itemPublicId: string) {
  const item = found(
    await db.selectFrom('learn_items as li').select('li.id').where('li.public_id', '=', itemPublicId).where(isPublished('li')).executeTakeFirst(),
    'Learn item',
  );
  const row = await db
    .insertInto('learn_item_completions')
    .values({ user_id: userId, learn_item_id: item.id })
    .onConflict((oc) => oc.columns(['user_id', 'learn_item_id']).doUpdateSet({ completed_at: sql`learn_item_completions.completed_at` }))
    .returning('completed_at')
    .executeTakeFirstOrThrow();
  return { id: itemPublicId, completed_at: row.completed_at };
}

export async function uncompleteLearnItem(userId: number, itemPublicId: string): Promise<void> {
  await db
    .deleteFrom('learn_item_completions')
    .where('user_id', '=', userId)
    .where('learn_item_id', '=', (eb) => eb.selectFrom('learn_items').select('id').where('public_id', '=', itemPublicId))
    .execute();
}
