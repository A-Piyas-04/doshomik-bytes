import { SEARCH_SUGGEST_MIN_CHARS } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { text } from '../../lib/validation';
import { search, SEARCH_TYPES, suggest } from './search.service';

const SearchQuery = z.object({
  q: text(100),
  type: z.enum(SEARCH_TYPES).optional(), // one group only, for "See all"
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/search', { schema: { querystring: SearchQuery } }, async (request) => {
    const { q, type, limit } = request.query;
    return search(request.auth.userId, q, limit, type ? [type] : undefined);
  });

  app.get(
    '/search/suggest',
    { schema: { querystring: z.object({ q: z.string().trim().min(SEARCH_SUGGEST_MIN_CHARS).max(100) }) } },
    async (request) => ({ items: await suggest(request.auth.userId, request.query.q) }),
  );
};
