import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { id, idParams, text } from '../../lib/validation';
import * as practice from './practice.service';

const QuestionsQuery = z.object({
  topic_id: id.optional(), // omit for Random
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const practiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/practice/questions', { schema: { querystring: QuestionsQuery } }, async (request) => ({
    items: await practice.listQuestions({ topicId: request.query.topic_id }, request.query.limit),
  }));

  app.post(
    '/practice/questions/:id/answer',
    { schema: { params: idParams, body: z.object({ answer: text(1000) }) } },
    async (request) => practice.checkAnswer(request.params.id, request.body.answer),
  );
};
