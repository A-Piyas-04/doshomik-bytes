import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../lib/auth';
import { adminLearnRoutes } from './learn.routes';
import { moderationRoutes } from './moderation.routes';
import { adminPracticeRoutes } from './practice.routes';
import { adminResearchRoutes } from './research.routes';
import { staffRoutes } from './staff.routes';

/**
 * The admin panel API. Staff need two-factor sign-in. Moderators work the reports queue;
 * admins also manage content (drafts → published), accounts and roles.
 * Team media is uploaded through POST /v1/media/uploads with purpose "learn" or "paper_figure".
 */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(async (moderators) => {
    moderators.addHook('onRequest', requireRole('moderator'));
    await moderators.register(moderationRoutes);
  });

  await app.register(async (admins) => {
    admins.addHook('onRequest', requireRole('admin'));
    await admins.register(adminLearnRoutes);
    await admins.register(adminPracticeRoutes);
    await admins.register(adminResearchRoutes);
    await admins.register(staffRoutes);
  });
};
