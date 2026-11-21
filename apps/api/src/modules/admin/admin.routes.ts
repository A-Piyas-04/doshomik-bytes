import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { readMultipart, storeUpload } from '../../lib/uploads';
import { adminLearnRoutes } from './learn.routes';
import { adminPracticeRoutes } from './practice.routes';
import { adminResearchRoutes } from './research.routes';

/** The content CMS used by the admin dashboard. Every route requires users.role = 'admin'. */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireAdmin);

  // multipart/form-data with one image or video. Returns the URL to put in media_url,
  // thumbnail_url or a paper figure.
  app.post('/media', async (request, reply) => {
    const { file } = await readMultipart(request, ['image', 'video']);
    if (!file) throw badRequest('Send one image or video file');
    const kind = file.kind;
    const { url, durationSeconds } = await storeUpload(file, 'content');
    return reply.status(201).send({ url, kind, duration_seconds: durationSeconds });
  });

  await app.register(adminLearnRoutes);
  await app.register(adminPracticeRoutes);
  await app.register(adminResearchRoutes);
};
