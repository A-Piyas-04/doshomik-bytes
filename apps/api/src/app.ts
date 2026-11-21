import { mkdir } from 'node:fs/promises';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { env } from './config/env';
import { db } from './db';
import { authenticate } from './lib/auth';
import { registerErrorHandler } from './lib/error-handler';
import { mediaRoot } from './lib/storage';
import { adminRoutes } from './modules/admin/admin.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { commentRoutes } from './modules/comments/comments.routes';
import { learnRoutes } from './modules/learn/learn.routes';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { postRoutes } from './modules/posts/posts.routes';
import { practiceRoutes } from './modules/practice/practice.routes';
import { researchRoutes } from './modules/research/research.routes';
import { searchRoutes } from './modules/search/search.routes';
import { userRoutes } from './modules/users/users.routes';

export async function buildApp() {
  const fastify = Fastify({ logger: env.NODE_ENV !== 'test' });
  registerErrorHandler(fastify);

  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: env.CORS_ORIGINS });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_EXPIRES_IN } });
  await app.register(multipart);
  if (env.NODE_ENV !== 'test') {
    await app.register(rateLimit, { global: false }); // opted into per route (sign-up, login)
  }

  // Uploaded media is public, like any image URL. The temp folder of unchecked uploads is not served.
  await mkdir(mediaRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: mediaRoot,
    prefix: '/media/',
    index: false,
    allowedPath: (pathname) => !pathname.startsWith('/tmp/'),
  });

  app.get('/health', async () => {
    await sql`select 1`.execute(db);
    return { status: 'ok' };
  });

  await app.register(authRoutes, { prefix: '/auth' });

  // Everything else needs a signed-in user.
  await app.register(async (api) => {
    api.addHook('onRequest', authenticate);
    await api.register(userRoutes);
    await api.register(postRoutes);
    await api.register(commentRoutes);
    await api.register(learnRoutes);
    await api.register(practiceRoutes);
    await api.register(researchRoutes);
    await api.register(notificationRoutes);
    await api.register(searchRoutes);
    await api.register(adminRoutes, { prefix: '/admin' });
  });

  return app;
}
