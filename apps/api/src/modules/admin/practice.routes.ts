import { QUESTION_KINDS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db';
import { audit } from '../../lib/audit';
import { found } from '../../lib/errors';
import { fetchPage } from '../../lib/pagination';
import { idParams, optionalText, slug, text, uniqueIds, updateOf } from '../../lib/validation';
import { topicRef } from '../learn/learn.service';
import { adminListQuery, contentId, idsInOrder, lifecycleRoutes, slugToId } from './content';

const QuestionFields = z.object({
  topic: slug,
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

const QuizBody = z.object({
  title: text(200),
  topic: slug.nullish(),
});

/** Staff view of questions: includes answers, explanations and status. */
const selectQuestions = () =>
  db
    .selectFrom('questions as q')
    .innerJoin('topics as t', 't.id', 'q.topic_id')
    .select(['q.public_id as id', 'q.status', 't.slug as topic', 'q.kind', 'q.prompt', 'q.options', 'q.answer', 'q.explanation', 'q.published_at', 'q.updated_at']);

const selectQuizzes = () =>
  db
    .selectFrom('quizzes as qz')
    .leftJoin('topics as t', 't.id', 'qz.topic_id')
    .select(['qz.public_id as id', 'qz.status', 'qz.title', topicRef('t').as('topic'), 'qz.created_at', 'qz.updated_at']);

export const adminPracticeRoutes: FastifyPluginAsyncZod = async (app) => {
  // ----- Questions -----
  app.get(
    '/questions',
    { schema: { querystring: adminListQuery.omit({ cursor: true, limit: true }).extend({ topic: slug.optional() }) } },
    async (request) => ({
      items: await selectQuestions()
        .$if(request.query.topic !== undefined, (qb) => qb.where('t.slug', '=', request.query.topic!))
        .$if(request.query.status !== undefined, (qb) => qb.where('q.status', '=', request.query.status!))
        .orderBy('q.id')
        .execute(),
    }),
  );

  app.post('/questions', { schema: { body: Question } }, async (request, reply) => {
    const questionPublicId = await db.transaction().execute(async (trx) => {
      const { topic, ...fields } = request.body;
      const row = await trx
        .insertInto('questions')
        .values({ ...fields, topic_id: await slugToId(trx, 'topics', topic), created_by: request.auth.userId, updated_by: request.auth.userId })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await audit(trx, request, { action: 'question.create', entityType: 'question', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectQuestions().where('q.public_id', '=', questionPublicId).executeTakeFirstOrThrow());
  });

  // The update is merged with the stored question and checked as a whole.
  app.patch('/questions/:id', { schema: { params: idParams, body: updateOf(QuestionFields) } }, async (request) => {
    const { id: _, status: __, published_at: ___, updated_at: ____, ...current } = found(
      await selectQuestions().where('q.public_id', '=', request.params.id).executeTakeFirst(),
      'Question',
    );
    const { topic, ...question } = Question.parse({ ...current, ...request.body });
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'questions', request.params.id);
      await trx
        .updateTable('questions')
        .set({ ...question, topic_id: await slugToId(trx, 'topics', topic), updated_by: request.auth.userId, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await audit(trx, request, { action: 'question.update', entityType: 'question', entityId: id, changes: request.body });
    });
    return selectQuestions().where('q.public_id', '=', request.params.id).executeTakeFirstOrThrow();
  });

  await app.register(lifecycleRoutes('/questions', 'questions'));

  // ----- Quizzes -----
  app.get('/quizzes', { schema: { querystring: adminListQuery } }, async (request) => {
    const { status, ...page } = request.query;
    return fetchPage(selectQuizzes().$if(status !== undefined, (qb) => qb.where('qz.status', '=', status!)), 'qz', page);
  });

  app.get('/quizzes/:id', { schema: { params: idParams } }, async (request) => {
    const quiz = found(await selectQuizzes().where('qz.public_id', '=', request.params.id).executeTakeFirst(), 'Quiz');
    const questions = await selectQuestions()
      .innerJoin('quiz_questions as qq', 'qq.question_id', 'q.id')
      .innerJoin('quizzes as qz', 'qz.id', 'qq.quiz_id')
      .where('qz.public_id', '=', request.params.id)
      .orderBy('qq.position')
      .execute();
    return { ...quiz, questions };
  });

  app.post('/quizzes', { schema: { body: QuizBody } }, async (request, reply) => {
    const quizPublicId = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('quizzes')
        .values({ title: request.body.title, topic_id: await slugToId(trx, 'topics', request.body.topic), created_by: request.auth.userId })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await audit(trx, request, { action: 'quiz.create', entityType: 'quiz', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectQuizzes().where('qz.public_id', '=', quizPublicId).executeTakeFirstOrThrow());
  });

  app.patch('/quizzes/:id', { schema: { params: idParams, body: updateOf(QuizBody) } }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'quizzes', request.params.id);
      await trx
        .updateTable('quizzes')
        .set({ title: request.body.title, topic_id: await slugToId(trx, 'topics', request.body.topic), updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await audit(trx, request, { action: 'quiz.update', entityType: 'quiz', entityId: id, changes: request.body });
    });
    return selectQuizzes().where('qz.public_id', '=', request.params.id).executeTakeFirstOrThrow();
  });

  /** Replaces the quiz's questions with `question_ids`, in that order. */
  app.put(
    '/quizzes/:id/questions',
    { schema: { params: idParams, body: z.object({ question_ids: uniqueIds(100) }) } },
    async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const quizId = await contentId(trx, 'quizzes', request.params.id);
        const questionIds = await idsInOrder(trx, 'questions', request.body.question_ids);
        await trx.deleteFrom('quiz_questions').where('quiz_id', '=', quizId).execute();
        if (questionIds.length) {
          await trx
            .insertInto('quiz_questions')
            .values(questionIds.map((questionId, index) => ({ quiz_id: quizId, question_id: questionId, position: index + 1 })))
            .execute();
        }
        await audit(trx, request, { action: 'quiz.reorder', entityType: 'quiz', entityId: quizId, changes: request.body });
      });
      return reply.status(204).send();
    },
  );

  await app.register(lifecycleRoutes('/quizzes', 'quizzes'));
};
