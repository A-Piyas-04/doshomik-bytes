import type { FastifyRequest } from 'fastify';

// Route-level limits for @fastify/rate-limit: tight on sign-in, posting and commenting, none on reading.
// Counters live in memory (per API process) until Redis is installed; then pass a Redis client
// to the plugin in app.ts and nothing here changes.

/** At most `max` requests per IP in `timeWindow`. For routes used before signing in. */
export const perIp = (max: number, timeWindow = '1 minute') => ({ rateLimit: { max, timeWindow } });

/** At most `max` requests per signed-in user in `timeWindow`. */
export const perUser = (max: number, timeWindow = '1 minute') => ({
  rateLimit: { max, timeWindow, keyGenerator: (request: FastifyRequest) => `user:${request.auth.userId}` },
});
