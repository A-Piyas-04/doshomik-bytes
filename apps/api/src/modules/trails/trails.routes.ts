import { CONTENT_LANGS, TRAIL_MAX_ITEMS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { perUser } from '../../lib/rate-limits';
import { idParams, optionalText, publicId, slug, text, updateOf } from '../../lib/validation';
import * as trails from './trails.service';

const Items = z
  .array(z.object({ paper_id: publicId, note: optionalText(280) }))
  .max(TRAIL_MAX_ITEMS)
  .refine((items) => new Set(items.map((item) => item.paper_id)).size === items.length, 'Each paper can appear once');

const TrailFields = z.object({
  title: text(120),
  description: optionalText(500),
  lang: z.enum(CONTENT_LANGS),
  field: slug.nullish(),
});

const CreateTrailBody = TrailFields.extend({
  lang: z.enum(CONTENT_LANGS).default('en'),
  items: Items.default([]),
  publish: z.boolean().default(false),
});

export const trailRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/trails',
    { schema: { querystring: pageQuery.extend({ field: slug.optional(), lang: z.enum(CONTENT_LANGS).optional() }) } },
    async (request) => {
      const { field, lang, ...page } = request.query;
      return trails.listTrails(request.auth.userId, { field, lang }, page);
    },
  );

  app.get('/users/:id/trails', { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
    trails.listUserTrails(request.auth.userId, request.params.id, request.query),
  );

  app.get('/trails/:id', { schema: { params: idParams } }, async (request) => trails.getTrail(request.auth.userId, request.params.id));

  app.post('/trails', { config: perUser(10), schema: { body: CreateTrailBody } }, async (request, reply) => {
    const { field, description, ...rest } = request.body;
    const trail = await trails.createTrail(request.auth.userId, { ...rest, description: description ?? null, field: field ?? undefined });
    return reply.status(201).send(trail);
  });

  app.patch('/trails/:id', { config: perUser(30), schema: { params: idParams, body: updateOf(TrailFields) } }, async (request) =>
    trails.updateTrail(request.auth.userId, request.params.id, request.body),
  );

  app.put('/trails/:id/items', { config: perUser(30), schema: { params: idParams, body: z.object({ items: Items }) } }, async (request) =>
    trails.setTrailItems(request.auth.userId, request.params.id, request.body.items),
  );

  app.put(
    '/trails/:id/status',
    { schema: { params: idParams, body: z.object({ status: z.enum(['draft', 'published']) }) } },
    async (request) => trails.setTrailStatus(request.auth.userId, request.params.id, request.body.status),
  );

  app.delete('/trails/:id', { schema: { params: idParams } }, async (request, reply) => {
    await trails.deleteTrail(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
