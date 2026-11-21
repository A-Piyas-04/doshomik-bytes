import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pageQuery } from '../../lib/pagination';
import { id, idParams } from '../../lib/validation';
import * as learn from './learn.service';

export const learnRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/topics', async () => ({ items: await learn.listTopics() }));

  app.get('/topics/:id', { schema: { params: idParams } }, async (request) => learn.getTopic(request.params.id));

  app.get(
    '/learn-items',
    { schema: { querystring: pageQuery.extend({ topic_id: id.optional() }) } },
    async (request) => learn.listLearnItems({ topicId: request.query.topic_id }, request.query),
  );

  app.get('/learn-items/:id', { schema: { params: idParams } }, async (request) =>
    learn.getLearnItem(request.params.id),
  );

  app.get('/courses', { schema: { querystring: pageQuery } }, async (request) => learn.listCourses(request.query));

  app.get('/courses/:id', { schema: { params: idParams } }, async (request) => learn.getCourse(request.params.id));
};
