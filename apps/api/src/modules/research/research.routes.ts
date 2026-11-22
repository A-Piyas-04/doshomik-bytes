import { PAPER_STATUSES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { idParams, slug, slugParams, text } from '../../lib/validation';
import * as research from './research.service';

const PapersQuery = pageQuery.extend({
  field: slug.optional(),
  q: text(100).optional(),
  interests: z.stringbool().optional(), // ?interests=true: only the viewer's onboarding fields
});

export const researchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/fields', async () => ({ items: await research.listFields() }));

  app.get('/fields/:slug/roadmap', { schema: { params: slugParams } }, async (request) =>
    research.getRoadmap(request.auth.userId, request.params.slug),
  );

  app.get('/papers', { schema: { querystring: PapersQuery } }, async (request) => {
    const { field, q, interests, ...page } = request.query;
    return research.listPapers(request.auth.userId, { field, q, interests }, page);
  });

  app.get('/papers/:id', { schema: { params: idParams } }, async (request) => research.getPaper(request.auth.userId, request.params.id));

  app.get('/papers/:id/learn-first', { schema: { params: idParams } }, async (request) => research.getLearnFirst(request.params.id));

  app.get(
    '/papers/:id/related',
    { schema: { params: idParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }) } },
    async (request) => ({ items: await research.getRelatedPapers(request.auth.userId, request.params.id, request.query.limit) }),
  );

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
