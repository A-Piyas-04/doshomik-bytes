import { QUESTION_KINDS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db';
import { found } from '../../lib/errors';
import { id, idParams, optionalText, text, updateOf } from '../../lib/validation';
import { deleteById } from './delete-by-id';

const QuestionFields = z.object({
  topic_id: id,
  kind: z.enum(QUESTION_KINDS),
  prompt: text(2000),
  options: z.array(text(500)).max(10).nullish(), // MCQ choices
  answer: text(1000), // MCQ: the correct option's text
  explanation: optionalText(5000),
});

/** MCQs need two or more options, and the answer must be one of them. Short questions have no options. */
const Question = QuestionFields.superRefine((question, ctx) => {
  if (question.kind !== 'mcq') return;
  if (!question.options || question.options.length < 2) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'MCQs need at least two options' });
  } else if (!question.options.includes(question.answer)) {
    ctx.addIssue({ code: 'custom', path: ['answer'], message: 'The answer must be one of the options' });
  }
}).transform((question) => ({ ...question, options: question.kind === 'mcq' ? question.options! : null }));

export const adminPracticeRoutes: FastifyPluginAsyncZod = async (app) => {
  // Unlike GET /practice/questions, this includes answers and explanations.
  app.get('/questions', { schema: { querystring: z.object({ topic_id: id.optional() }) } }, async (request) => ({
    items: await db
      .selectFrom('questions')
      .selectAll()
      .$if(request.query.topic_id !== undefined, (qb) => qb.where('topic_id', '=', request.query.topic_id!))
      .orderBy('id')
      .execute(),
  }));

  app.post('/questions', { schema: { body: Question } }, async (request, reply) => {
    const question = await db.insertInto('questions').values(request.body).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(question);
  });

  // The update is merged with the stored question and checked as a whole.
  app.patch('/questions/:id', { schema: { params: idParams, body: updateOf(QuestionFields) } }, async (request) => {
    const { id: _, ...current } = found(
      await db.selectFrom('questions').selectAll().where('id', '=', request.params.id).executeTakeFirst(),
      'Question',
    );
    const question = Question.parse({ ...current, ...request.body });
    return db.updateTable('questions').set(question).where('id', '=', request.params.id).returningAll().executeTakeFirstOrThrow();
  });

  app.delete('/questions/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('questions', request.params.id, 'Question');
    return reply.status(204).send();
  });
};
