import { db } from '../../db';
import { found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';

const LEARN_ITEM_COLUMNS = [
  'li.id',
  'li.topic_id',
  'li.title',
  'li.kind',
  'li.media_url',
  'li.body',
  'li.duration_seconds',
  'li.created_at',
] as const;

export function listTopics() {
  return db.selectFrom('topics').select(['id', 'name', 'summary']).orderBy('name').execute();
}

export async function getTopic(topicId: number) {
  const topic = found(
    await db.selectFrom('topics').select(['id', 'name', 'summary']).where('id', '=', topicId).executeTakeFirst(),
    'Topic',
  );
  const learnItems = await db
    .selectFrom('learn_items as li')
    .select(LEARN_ITEM_COLUMNS)
    .where('li.topic_id', '=', topicId)
    .orderBy('li.id')
    .execute();
  return { ...topic, learn_items: learnItems };
}

export function listLearnItems(filter: { topicId?: number }, page: PageQuery) {
  const query = db
    .selectFrom('learn_items as li')
    .select(LEARN_ITEM_COLUMNS)
    .$if(filter.topicId !== undefined, (qb) => qb.where('li.topic_id', '=', filter.topicId!));
  return fetchPage(query, 'li', page);
}

export async function getLearnItem(itemId: number) {
  const item = await db
    .selectFrom('learn_items as li')
    .leftJoin('topics as t', 't.id', 'li.topic_id')
    .select([...LEARN_ITEM_COLUMNS, 't.name as topic_name'])
    .where('li.id', '=', itemId)
    .executeTakeFirst();
  return found(item, 'Learn item');
}

/** Our courses and external course cards. An external course has `external_url` and no items. */
export function listCourses(page: PageQuery) {
  const query = db
    .selectFrom('courses as c')
    .select((eb) => [
      'c.id',
      'c.title',
      'c.description',
      'c.thumbnail_url',
      'c.external_url',
      'c.created_at',
      eb
        .selectFrom('course_items as ci')
        .whereRef('ci.course_id', '=', 'c.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('item_count'),
    ]);
  return fetchPage(query, 'c', page);
}

/** A course with its learn items in step order. */
export async function getCourse(courseId: number) {
  const course = found(
    await db
      .selectFrom('courses')
      .select(['id', 'title', 'description', 'thumbnail_url', 'external_url', 'created_at'])
      .where('id', '=', courseId)
      .executeTakeFirst(),
    'Course',
  );
  const items = await db
    .selectFrom('course_items as ci')
    .innerJoin('learn_items as li', 'li.id', 'ci.item_id')
    .select(['ci.position', ...LEARN_ITEM_COLUMNS])
    .where('ci.course_id', '=', courseId)
    .orderBy('ci.position')
    .execute();
  return { ...course, items };
}
