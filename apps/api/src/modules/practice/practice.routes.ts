import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { idParams, slug, text } from '../../lib/validation';
import * as practice from './practice.service';

const QuestionsQuery = z.object({
  topic: slug.optional(), // omit both for Random
  field: slug.optional(), // a learn area: questions from all of its topics
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const practiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/practice/questions', { schema: { querystring: QuestionsQuery } }, async (request) => ({
    items: await practice.listQuestions({ topic: request.query.topic, field: request.query.field }, request.query.limit),
  }));

  app.post(
    '/practice/questions/:id/answer',
    { schema: { params: idParams, body: z.object({ answer: text(1000) }) } },
    async (request) => practice.checkAnswer(request.auth.userId, request.params.id, request.body.answer),
  );

  app.get('/me/practice/history', { schema: { querystring: pageQuery } }, async (request) =>
    practice.listHistory(request.auth.userId, request.query),
  );

  app.get('/me/practice/stats', async (request) => practice.getStats(request.auth.userId));

  app.get('/quizzes', { schema: { querystring: pageQuery.extend({ topic: slug.optional(), field: slug.optional() }) } }, async (request) => {
    const { topic, field, ...page } = request.query;
    return practice.listQuizzes({ topic, field }, page);
  });

  app.get('/quizzes/:id', { schema: { params: idParams } }, async (request) => practice.getQuiz(request.params.id));
};
