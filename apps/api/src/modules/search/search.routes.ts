import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { text } from '../../lib/validation';
import { search, SEARCH_TYPES } from './search.service';

const SearchQuery = z.object({
  q: text(100),
  type: z.enum(SEARCH_TYPES).optional(), // one group only, for "See all"
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/search', { schema: { querystring: SearchQuery } }, async (request) => {
    const { q, type, limit } = request.query;
    return search(request.user.id, q, limit, type ? [type] : undefined);
  });
};
