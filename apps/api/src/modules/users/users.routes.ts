import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { readMultipart, storeUpload } from '../../lib/uploads';
import { idParams, optionalText } from '../../lib/validation';
import * as users from './users.service';

const UpdateProfileBody = z.object({
  display_name: optionalText(50),
  bio: optionalText(300),
});

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', async (request) => users.getAccount(request.user.id));

  app.patch('/me', { schema: { body: UpdateProfileBody } }, async (request) =>
    users.updateProfile(request.user.id, request.body),
  );

  // multipart/form-data with one image file.
  app.put('/me/avatar', async (request) => {
    const { file } = await readMultipart(request, ['image']);
    if (!file) throw badRequest('Send one image file');
    const { url } = await storeUpload(file, 'avatars');
    return users.setAvatar(request.user.id, url);
  });

  app.get(
    '/users/suggestions',
    { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) } },
    async (request) => ({ items: await users.suggestUsers(request.user.id, request.query.limit) }),
  );

  app.get('/users/:id', { schema: { params: idParams } }, async (request) =>
    users.getProfile(request.user.id, request.params.id),
  );

  app.put('/users/:id/follow', { schema: { params: idParams } }, async (request, reply) => {
    await users.follow(request.user.id, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/users/:id/follow', { schema: { params: idParams } }, async (request, reply) => {
    await users.unfollow(request.user.id, request.params.id);
    return reply.status(204).send();
  });
};
