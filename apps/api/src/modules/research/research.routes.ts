import { PAPER_STATUSES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { id, idParams, text } from '../../lib/validation';
import * as research from './research.service';

const PapersQuery = pageQuery.extend({
  field_id: id.optional(),
  q: text(100).optional(),
});

export const researchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/fields', async () => ({ items: await research.listFields() }));

  app.get('/fields/:id/roadmap', { schema: { params: idParams } }, async (request) =>
    research.getRoadmap(request.user.id, request.params.id),
  );

  app.get('/papers', { schema: { querystring: PapersQuery } }, async (request) => {
    const { field_id, q, ...page } = request.query;
    return research.listPapers(request.user.id, { fieldId: field_id, q }, page);
  });

  app.get('/papers/:id', { schema: { params: idParams } }, async (request) =>
    research.getPaper(request.user.id, request.params.id),
  );

  app.get('/papers/:id/learn-first', { schema: { params: idParams } }, async (request) =>
    research.getLearnFirst(request.params.id),
  );

  app.put(
    '/papers/:id/status',
    { schema: { params: idParams, body: z.object({ status: z.enum(PAPER_STATUSES) }) } },
    async (request) => research.setPaperStatus(request.user.id, request.params.id, request.body.status),
  );

  app.delete('/papers/:id/status', { schema: { params: idParams } }, async (request, reply) => {
    await research.removePaperStatus(request.user.id, request.params.id);
    return reply.status(204).send();
  });

  app.get('/users/:id/papers', { schema: { params: idParams } }, async (request) =>
    research.getReadingTracker(request.user.id, request.params.id),
  );
};
