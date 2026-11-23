import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { idParams, slug, slugParams } from '../../lib/validation';
import * as learn from './learn.service';

export const learnRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/topics', async () => ({ items: await learn.listTopics() }));

  app.get('/topics/:slug', { schema: { params: slugParams } }, async (request) => learn.getTopic(request.params.slug));

  app.get('/learn-items', { schema: { querystring: pageQuery.extend({ topic: slug.optional() }) } }, async (request) => {
    const { topic, ...page } = request.query;
    return learn.listLearnItems({ topic }, page);
  });

  app.get('/learn-items/:id', { schema: { params: idParams } }, async (request) => learn.getLearnItem(request.params.id));

  app.get('/courses', { schema: { querystring: pageQuery } }, async (request) =>
    learn.listCourses(request.auth.userId, request.query),
  );

  app.get('/courses/:id', { schema: { params: idParams } }, async (request) =>
    learn.getCourse(request.auth.userId, request.params.id),
  );

  app.put(
    '/courses/:id/progress',
    { schema: { params: idParams, body: z.object({ last_position: z.number().int().min(0).max(1000) }) } },
    async (request) => learn.saveProgress(request.auth.userId, request.params.id, request.body.last_position),
  );

  app.get('/me/courses', { schema: { querystring: pageQuery } }, async (request) =>
    learn.listMyCourses(request.auth.userId, request.query),
  );

  // ----- Learn before reading (A13) -----
  app.put('/topics/:slug/known', { schema: { params: slugParams } }, async (request, reply) => {
    await learn.markTopicKnown(request.auth.userId, request.params.slug);
    return reply.status(204).send();
  });

  app.delete('/topics/:slug/known', { schema: { params: slugParams } }, async (request, reply) => {
    await learn.unmarkTopicKnown(request.auth.userId, request.params.slug);
    return reply.status(204).send();
  });

  app.put('/learn-items/:id/complete', { schema: { params: idParams } }, async (request) =>
    learn.completeLearnItem(request.auth.userId, request.params.id),
  );

  app.delete('/learn-items/:id/complete', { schema: { params: idParams } }, async (request, reply) => {
    await learn.uncompleteLearnItem(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
