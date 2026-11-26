import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { env } from './config/env';
import { db } from './db';
import { authenticate } from './lib/auth';
import { deriveKey } from './lib/crypto';
import { registerErrorHandler } from './lib/error-handler';
import { localStorage } from './lib/storage';
import { adminRoutes } from './modules/admin/admin.routes';
import { appConfigRoutes, deepLinkRoutes } from './modules/app/app.routes';
import { accountSecurityRoutes, authRoutes } from './modules/auth/auth.routes';
import { commentRoutes } from './modules/comments/comments.routes';
import { learnRoutes } from './modules/learn/learn.routes';
import { mediaRoutes } from './modules/media/media.routes';
import { storageRoutes } from './modules/media/storage.routes';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { postRoutes } from './modules/posts/posts.routes';
import { practiceRoutes } from './modules/practice/practice.routes';
import { reportRoutes } from './modules/reports/reports.routes';
import { researchRoutes } from './modules/research/research.routes';
import { searchRoutes } from './modules/search/search.routes';
import { trailRoutes } from './modules/trails/trails.routes';
import { userRoutes } from './modules/users/users.routes';

/** Signed upload and media URLs carry their token in the path; keep it out of the logs. */
const redactUrl = (url: string) => url.replace(/\/(storage\/raw|media\/s)\/[^/?]+/, '/$1/[token]');

export async function buildApp() {
  const fastify = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false, // ids are ours, not the client's
    routerOptions: { maxParamLength: 500 }, // signed upload and media tokens are path segments
    trustProxy: env.NODE_ENV === 'production', // behind Caddy, for the client IP in rate limits and audit
    logger:
      env.NODE_ENV === 'test'
        ? false
        : { serializers: { req: (request) => ({ id: request.id, method: request.method, url: redactUrl(request.url) }) } },
  });
  registerErrorHandler(fastify);

  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    if (env.NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  await app.register(compress);
  await app.register(etag);
  // Browser clients (the admin dashboard, the app's web build) use every verb the API has; the
  // plugin's default allows only GET, HEAD and POST, which blocked saves, toggles and edits.
  await app.register(cors, { origin: env.CORS_ORIGINS, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(jwt, { secret: deriveKey('jwt'), sign: { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS } });
  if (env.NODE_ENV !== 'test') {
    // Opted into per route (lib/rate-limits.ts). preHandler, so per-user limits know the user.
    await app.register(rateLimit, { global: false, hook: 'preHandler' });
  }

  await mkdir(path.join(localStorage.processedDir, 'public'), { recursive: true });
  await app.register(storageRoutes);
  await app.register(deepLinkRoutes);

  app.get('/health', async () => {
    await sql`select 1`.execute(db);
    return { status: 'ok' };
  });

  // Versioned API: old app versions stay installed for months.
  await app.register(
    async (v1) => {
      await v1.register(appConfigRoutes);
      await v1.register(authRoutes, { prefix: '/auth' });

      // Everything else needs a signed-in user.
      await v1.register(async (api) => {
        api.addHook('onRequest', authenticate);
        await api.register(accountSecurityRoutes);
        await api.register(userRoutes);
        await api.register(mediaRoutes);
        await api.register(postRoutes);
        await api.register(commentRoutes);
        await api.register(learnRoutes);
        await api.register(practiceRoutes);
        await api.register(researchRoutes);
        await api.register(trailRoutes);
        await api.register(notificationRoutes);
        await api.register(searchRoutes);
        await api.register(reportRoutes);
        await api.register(adminRoutes, { prefix: '/admin' });
      });
    },
    { prefix: '/v1' },
  );

  return app;
}
