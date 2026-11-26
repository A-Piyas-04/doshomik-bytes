import { LEARN_ITEM_KINDS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, type Db } from '../../db';
import { audit } from '../../lib/audit';
import { badRequest, found } from '../../lib/errors';
import { emitSearchSync } from '../../lib/outbox';
import { fetchPage } from '../../lib/pagination';
import { httpUrl, idParams, optionalText, publicId, slug, slugify, slugParams, text, uniqueIds, updateOf } from '../../lib/validation';
import { fieldRef, topicRef } from '../learn/learn.service';
import { MEDIA_COLUMNS, type MediaColumns, withMediaView } from '../media/media.service';
import { adminListQuery, contentId, contentMediaId, idsInOrder, lifecycleRoutes, slugToId, syncSearch } from './content';

const TopicBody = z.object({
  name: text(100),
  slug: slug.optional(), // defaults to one made from the name
  summary: optionalText(1000), // shown in Learn first when the topic has no learn items yet
  field: slug.nullish(), // the learn area (a field slug) the concept belongs to; null unfiles it
});

const LearnItemFields = z.object({
  topic: slug.nullish(),
  title: text(200),
  kind: z.enum(LEARN_ITEM_KINDS),
  media_id: publicId.nullish(), // an upload with purpose "learn"
  media_url: httpUrl.nullish(), // or an outside link
  body: optionalText(20_000),
  duration_seconds: z.number().int().min(1).max(32_767).nullish(),
});

const CourseBody = z.object({
  title: text(200),
  description: optionalText(2000),
  thumbnail_url: httpUrl.nullish(),
  external_url: httpUrl.nullish(), // set for an outside course card; such a course has no items
  field: slug.nullish(), // the learn area (a field slug); null unfiles it
});

/** The public shape of a topic row joined with its field. */
const topicColumns = ['t.id', 't.slug', 't.name', 't.summary', fieldRef('f').as('field')] as const;
const selectTopic = (trx: Db, id: number) =>
  trx.selectFrom('topics as t').leftJoin('fields as f', 'f.id', 't.field_id').select(topicColumns).where('t.id', '=', id).executeTakeFirstOrThrow();

export const adminLearnRoutes: FastifyPluginAsyncZod = async (app) => {
  // ----- Topics (always live; no drafts) -----
  app.post('/topics', { schema: { body: TopicBody } }, async (request, reply) => {
    const topicSlug = request.body.slug ?? slugify(request.body.name);
    if (!topicSlug) throw badRequest('This name has no letters a–z: give the topic a slug', 'SLUG_REQUIRED');
    const topic = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('topics')
        .values({
          name: request.body.name,
          slug: topicSlug,
          summary: request.body.summary,
          field_id: (await slugToId(trx, 'fields', request.body.field)) ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await emitSearchSync(trx, 'topic', row.id);
      await audit(trx, request, { action: 'topic.create', entityType: 'topic', entityId: row.id, changes: request.body });
      return selectTopic(trx, row.id);
    });
    const { id: _, ...publicTopic } = topic;
    return reply.status(201).send(publicTopic);
  });

  app.patch('/topics/:slug', { schema: { params: slugParams, body: updateOf(TopicBody) } }, async (request) =>
    db.transaction().execute(async (trx) => {
      const { field, ...changes } = request.body;
      const row = found(
        await trx
          .updateTable('topics')
          .set({ ...changes, ...(field !== undefined ? { field_id: await slugToId(trx, 'fields', field) } : {}) })
          .where('slug', '=', request.params.slug)
          .returning('id')
          .executeTakeFirst(),
        'Topic',
      );
      await emitSearchSync(trx, 'topic', row.id);
      await audit(trx, request, { action: 'topic.update', entityType: 'topic', entityId: row.id, changes: request.body });
      const { id: _, ...publicTopic } = await selectTopic(trx, row.id);
      return publicTopic;
    }),
  );

  app.delete('/topics/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const row = found(await trx.deleteFrom('topics').where('slug', '=', request.params.slug).returning('id').executeTakeFirst(), 'Topic');
      await emitSearchSync(trx, 'topic', row.id);
      await audit(trx, request, { action: 'topic.delete', entityType: 'topic', entityId: row.id });
    });
    return reply.status(204).send();
  });

  // ----- Learn items (drafts until published) -----
  const selectItems = () =>
    db
      .selectFrom('learn_items as li')
      .leftJoin('topics as t', 't.id', 'li.topic_id')
      .leftJoin('media_assets as m', 'm.id', 'li.media_id')
      .select([
        'li.public_id as id',
        'li.status',
        topicRef('t').as('topic'),
        'li.title',
        'li.kind',
        'li.body',
        'li.media_url',
        'li.duration_seconds',
        'li.published_at',
        'li.created_at',
        'li.updated_at',
        ...MEDIA_COLUMNS,
      ]);
  const toItem = <T extends MediaColumns>(row: T) => withMediaView(row, { private: false });

  app.get('/learn-items', { schema: { querystring: adminListQuery } }, async (request) => {
    const { status, ...page } = request.query;
    const result = await fetchPage(selectItems().$if(status !== undefined, (qb) => qb.where('li.status', '=', status!)), 'li', page);
    return { ...result, items: result.items.map(toItem) };
  });

  app.get('/learn-items/:id', { schema: { params: idParams } }, async (request) =>
    toItem(found(await selectItems().where('li.public_id', '=', request.params.id).executeTakeFirst(), 'Learn item')),
  );

  const NewLearnItem = LearnItemFields.refine((item) => item.kind === 'text' || item.media_id || item.media_url, {
    message: 'Video and image items need a media_id or a media_url',
    path: ['media_id'],
  });

  app.post('/learn-items', { schema: { body: NewLearnItem } }, async (request, reply) => {
    const itemPublicId = await db.transaction().execute(async (trx) => {
      const { topic, media_id, ...fields } = request.body;
      const row = await trx
        .insertInto('learn_items')
        .values({
          ...fields,
          topic_id: await slugToId(trx, 'topics', topic),
          media_id: await contentMediaId(trx, media_id),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await syncSearch(trx, 'learn_items', row.id);
      await audit(trx, request, { action: 'learn_item.create', entityType: 'learn_item', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(toItem(await selectItems().where('li.public_id', '=', itemPublicId).executeTakeFirstOrThrow()));
  });

  app.patch('/learn-items/:id', { schema: { params: idParams, body: updateOf(LearnItemFields) } }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'learn_items', request.params.id);
      const { topic, media_id, ...fields } = request.body;
      await trx
        .updateTable('learn_items')
        .set({
          ...fields,
          topic_id: await slugToId(trx, 'topics', topic),
          media_id: await contentMediaId(trx, media_id),
          updated_by: request.auth.userId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await syncSearch(trx, 'learn_items', id);
      await audit(trx, request, { action: 'learn_item.update', entityType: 'learn_item', entityId: id, changes: request.body });
    });
    return toItem(await selectItems().where('li.public_id', '=', request.params.id).executeTakeFirstOrThrow());
  });

  await app.register(lifecycleRoutes('/learn-items', 'learn_items'));

  // ----- Courses (drafts until published) -----
  const selectCourses = () =>
    db
      .selectFrom('courses as c')
      .leftJoin('fields as cf', 'cf.id', 'c.field_id')
      .select((eb) => [
        'c.public_id as id',
        'c.status',
        'c.title',
        'c.description',
        'c.thumbnail_url',
        'c.external_url',
        fieldRef('cf').as('field'),
        'c.published_at',
        'c.created_at',
        'c.updated_at',
        eb.selectFrom('course_items as ci').whereRef('ci.course_id', '=', 'c.id').select(({ fn }) => fn.countAll<number>().as('n')).as('item_count'),
      ]);

  app.get('/courses', { schema: { querystring: adminListQuery } }, async (request) => {
    const { status, ...page } = request.query;
    return fetchPage(selectCourses().$if(status !== undefined, (qb) => qb.where('c.status', '=', status!)), 'c', page);
  });

  /** A course with all its items, drafts included, so the team can preview before publishing. */
  app.get('/courses/:id', { schema: { params: idParams } }, async (request) => {
    const course = found(await selectCourses().where('c.public_id', '=', request.params.id).executeTakeFirst(), 'Course');
    const items = await db
      .selectFrom('course_items as ci')
      .innerJoin('courses as c', 'c.id', 'ci.course_id')
      .innerJoin('learn_items as li', 'li.id', 'ci.item_id')
      .select(['ci.position', 'li.public_id as id', 'li.title', 'li.kind', 'li.status'])
      .where('c.public_id', '=', request.params.id)
      .orderBy('ci.position')
      .execute();
    return { ...course, items };
  });

  app.post('/courses', { schema: { body: CourseBody } }, async (request, reply) => {
    const coursePublicId = await db.transaction().execute(async (trx) => {
      const { field, ...fields } = request.body;
      const row = await trx
        .insertInto('courses')
        .values({
          ...fields,
          field_id: (await slugToId(trx, 'fields', field)) ?? null,
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await syncSearch(trx, 'courses', row.id);
      await audit(trx, request, { action: 'course.create', entityType: 'course', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectCourses().where('c.public_id', '=', coursePublicId).executeTakeFirstOrThrow());
  });

  app.patch('/courses/:id', { schema: { params: idParams, body: updateOf(CourseBody) } }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'courses', request.params.id);
      const { field, ...changes } = request.body;
      await trx
        .updateTable('courses')
        .set({
          ...changes,
          ...(field !== undefined ? { field_id: await slugToId(trx, 'fields', field) } : {}),
          updated_by: request.auth.userId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await syncSearch(trx, 'courses', id);
      await audit(trx, request, { action: 'course.update', entityType: 'course', entityId: id, changes: request.body });
    });
    return selectCourses().where('c.public_id', '=', request.params.id).executeTakeFirstOrThrow();
  });

  /** Replaces the course's steps with `item_ids`, in that order. */
  app.put(
    '/courses/:id/items',
    { schema: { params: idParams, body: z.object({ item_ids: uniqueIds(200) }) } },
    async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const course = found(
          await trx.selectFrom('courses').select(['id', 'external_url']).where('public_id', '=', request.params.id).executeTakeFirst(),
          'Course',
        );
        if (course.external_url) throw badRequest('External courses have no items', 'EXTERNAL_COURSE');
        const itemIds = await idsInOrder(trx, 'learn_items', request.body.item_ids);

        await trx.deleteFrom('course_items').where('course_id', '=', course.id).execute();
        if (itemIds.length) {
          await trx
            .insertInto('course_items')
            .values(itemIds.map((itemId, index) => ({ course_id: course.id, item_id: itemId, position: index + 1 })))
            .execute();
        }
        await trx.updateTable('courses').set({ updated_by: request.auth.userId, updated_at: sql`now()` }).where('id', '=', course.id).execute();
        await audit(trx, request, { action: 'course.reorder', entityType: 'course', entityId: course.id, changes: request.body });
      });
      return reply.status(204).send();
    },
  );

  await app.register(lifecycleRoutes('/courses', 'courses'));
};
