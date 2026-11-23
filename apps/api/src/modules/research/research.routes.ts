import { PAPER_NOTE_MAX_LENGTH, PAPER_STATUSES, READING_STEPS, type ReadingStep } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { perUser } from '../../lib/rate-limits';
import { idParams, optionalText, slug, slugParams, text } from '../../lib/validation';
import * as research from './research.service';

const PapersQuery = pageQuery.extend({
  field: slug.optional(),
  q: text(100).optional(),
  interests: z.stringbool().optional(), // ?interests=true: only the viewer's onboarding fields
  sort: z.enum(['trend', 'newest']).default('trend'),
});

/** 0 = not read, 1 Explored, 2 Studied, 3 Reproduced. */
const step = z
  .number()
  .int()
  .min(READING_STEPS[0])
  .max(READING_STEPS[READING_STEPS.length - 1]!)
  .transform((value) => value as ReadingStep);

export const researchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/fields', async () => ({ items: await research.listFields() }));

  app.get('/fields/:slug/roadmap', { schema: { params: slugParams } }, async (request) =>
    research.getRoadmap(request.auth.userId, request.params.slug),
  );

  // ----- A1 / A2: the collection, filtered by chip, searched, in trend order -----
  app.get('/papers', { schema: { querystring: PapersQuery } }, async (request) => {
    const { field, q, interests, sort, ...page } = request.query;
    return research.listPapers(request.auth.userId, { field, q, interests, sort }, page);
  });

  app.get('/papers/:id', { schema: { params: idParams } }, async (request) => research.getPaper(request.auth.userId, request.params.id));

  app.get('/papers/:id/learn-first', { schema: { params: idParams } }, async (request) =>
    research.getLearnFirst(request.auth.userId, request.params.id),
  );

  app.get(
    '/papers/:id/related',
    { schema: { params: idParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }) } },
    async (request) => ({ items: await research.getRelatedPapers(request.auth.userId, request.params.id, request.query.limit) }),
  );

  // ----- A6: lineage (three up, three down by default) -----
  app.get(
    '/papers/:id/lineage',
    { schema: { params: idParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(20).default(3) }) } },
    async (request) => research.getLineage(request.auth.userId, request.params.id, request.query.limit),
  );

  // ----- A3: bookmark -----
  app.put('/papers/:id/save', { schema: { params: idParams } }, async (request, reply) => {
    await research.savePaper(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/papers/:id/save', { schema: { params: idParams } }, async (request, reply) => {
    await research.unsavePaper(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  // ----- A4: three-step tracker and private note -----
  app.put('/papers/:id/reading', { schema: { params: idParams, body: z.object({ step }) } }, async (request) =>
    research.setReadingStep(request.auth.userId, request.params.id, request.body.step, 'exact'),
  );

  /** The bottom bar's one-tap "Mark read": step 1, never lowering a higher step. */
  app.post('/papers/:id/mark-read', { schema: { params: idParams } }, async (request) =>
    research.setReadingStep(request.auth.userId, request.params.id, 1, 'at_least'),
  );

  app.put(
    '/papers/:id/note',
    { config: perUser(60), schema: { params: idParams, body: z.object({ note: optionalText(PAPER_NOTE_MAX_LENGTH) }) } },
    async (request) => research.setPaperNote(request.auth.userId, request.params.id, request.body.note ?? null),
  );

  // ----- A5: My papers -----
  app.get('/me/papers/up-next', async (request) => research.getUpNext(request.auth.userId));

  app.get('/me/papers', { schema: { querystring: pageQuery.extend({ list: z.enum(['saved', 'read']).default('saved') }) } }, async (request) => {
    const { list, ...page } = request.query;
    return research.listMyPapers(request.auth.userId, list, page);
  });

  app.get('/me/reading/stats', async (request) => research.getMyReadingStats(request.auth.userId));

  app.get('/users/:id/reading', { schema: { params: idParams } }, async (request) =>
    research.getUserReadingStats(request.auth.userId, request.params.id),
  );

  app.get('/me/research-outputs', { schema: { querystring: pageQuery } }, async (request) =>
    research.listResearchOutputs(request.auth.userId, request.query),
  );

  app.get('/research-outputs/:id', { schema: { params: idParams } }, async (request) =>
    research.getResearchOutput(request.auth.userId, request.params.id),
  );

  app.delete('/research-outputs/:id', { schema: { params: idParams } }, async (request, reply) => {
    await research.deleteResearchOutput(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  // ----- Prototype 2 tracker (kept as it was; superseded by /save, /reading and /note) -----
  app.put(
    '/papers/:id/status',
    { schema: { params: idParams, body: z.object({ status: z.enum(PAPER_STATUSES) }) } },
    async (request) => research.setPaperStatus(request.auth.userId, request.params.id, request.body.status),
  );

  app.delete('/papers/:id/status', { schema: { params: idParams } }, async (request, reply) => {
    await research.removePaperStatus(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.get('/users/:id/papers', { schema: { params: idParams } }, async (request) =>
    research.getReadingTracker(request.auth.userId, request.params.id),
  );
};
