import { LEARN_ITEM_KINDS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db';
import { badRequest, found } from '../../lib/errors';
import { httpUrl, id, idParams, optionalText, text, updateOf } from '../../lib/validation';
import { deleteById } from './delete-by-id';

const TopicBody = z.object({
  name: text(100),
  summary: optionalText(1000), // shown in Learn first when the topic has no learn items yet
});

const LearnItemBody = z.object({
  topic_id: id.nullish(),
  title: text(200),
  kind: z.enum(LEARN_ITEM_KINDS),
  media_url: httpUrl.nullish(), // from POST /admin/media
  body: optionalText(20_000),
  duration_seconds: z.number().int().min(1).max(32_767).nullish(),
});

const CourseBody = z.object({
  title: text(200),
  description: optionalText(2000),
  thumbnail_url: httpUrl.nullish(),
  external_url: httpUrl.nullish(), // set for an outside course card; such a course has no items
});

const CourseItemsBody = z.object({
  item_ids: z
    .array(id)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Each learn item can appear once per course'),
});

export const adminLearnRoutes: FastifyPluginAsyncZod = async (app) => {
  // Topics
  app.post('/topics', { schema: { body: TopicBody } }, async (request, reply) => {
    const topic = await db.insertInto('topics').values(request.body).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(topic);
  });

  app.patch('/topics/:id', { schema: { params: idParams, body: updateOf(TopicBody) } }, async (request) =>
    found(
      await db.updateTable('topics').set(request.body).where('id', '=', request.params.id).returningAll().executeTakeFirst(),
      'Topic',
    ),
  );

  app.delete('/topics/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('topics', request.params.id, 'Topic');
    return reply.status(204).send();
  });

  // Learn items
  const NewLearnItem = LearnItemBody.refine((item) => item.kind === 'text' || item.media_url, {
    message: 'Video and image items need a media_url',
    path: ['media_url'],
  });

  app.post('/learn-items', { schema: { body: NewLearnItem } }, async (request, reply) => {
    const item = await db.insertInto('learn_items').values(request.body).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(item);
  });

  app.patch('/learn-items/:id', { schema: { params: idParams, body: updateOf(LearnItemBody) } }, async (request) =>
    found(
      await db
        .updateTable('learn_items')
        .set(request.body)
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst(),
      'Learn item',
    ),
  );

  app.delete('/learn-items/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('learn_items', request.params.id, 'Learn item');
    return reply.status(204).send();
  });

  // Courses
  app.post('/courses', { schema: { body: CourseBody } }, async (request, reply) => {
    const course = await db.insertInto('courses').values(request.body).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(course);
  });

  app.patch('/courses/:id', { schema: { params: idParams, body: updateOf(CourseBody) } }, async (request) =>
    found(
      await db.updateTable('courses').set(request.body).where('id', '=', request.params.id).returningAll().executeTakeFirst(),
      'Course',
    ),
  );

  app.delete('/courses/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('courses', request.params.id, 'Course');
    return reply.status(204).send();
  });

  /** Replaces the course's steps with `item_ids`, in that order. */
  app.put('/courses/:id/items', { schema: { params: idParams, body: CourseItemsBody } }, async (request, reply) => {
    const courseId = request.params.id;
    const course = found(
      await db.selectFrom('courses').select('external_url').where('id', '=', courseId).executeTakeFirst(),
      'Course',
    );
    if (course.external_url) throw badRequest('External courses have no items', 'EXTERNAL_COURSE');

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('course_items').where('course_id', '=', courseId).execute();
      if (request.body.item_ids.length === 0) return;
      await trx
        .insertInto('course_items')
        .values(request.body.item_ids.map((itemId, index) => ({ course_id: courseId, item_id: itemId, position: index + 1 })))
        .execute();
    });
    return reply.status(204).send();
  });
};
