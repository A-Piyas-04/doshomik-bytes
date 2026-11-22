import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pageQuery } from '../../lib/pagination';
import { idParams } from '../../lib/validation';
import * as notifications from './notifications.service';

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/notifications', { schema: { querystring: pageQuery } }, async (request) =>
    notifications.listNotifications(request.auth.userId, request.query),
  );

  app.get('/notifications/unread-count', async (request) => ({
    count: await notifications.countUnread(request.auth.userId),
  }));

  app.post('/notifications/:id/read', { schema: { params: idParams } }, async (request, reply) => {
    await notifications.markRead(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
