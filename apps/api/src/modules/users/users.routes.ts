import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { idParams, optionalText, slug } from '../../lib/validation';
import * as users from './users.service';

const UpdateProfileBody = z.object({
  display_name: optionalText(50),
  bio: optionalText(300),
  is_private: z.boolean().optional(),
});

const DeleteAccountBody = z.object({
  password: z.string().max(200).optional(), // required for accounts that have a password
});

const InterestsBody = z.object({
  fields: z.array(slug).max(20),
});

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  // ----- Own account -----
  app.get('/me', async (request) => users.getAccount(request.auth.userId));

  app.patch('/me', { schema: { body: UpdateProfileBody } }, async (request) =>
    users.updateProfile(request.auth.userId, request.body),
  );

  app.delete('/me', { schema: { body: DeleteAccountBody.optional() } }, async (request, reply) => {
    await users.deleteAccount(request, request.body?.password);
    return reply.status(204).send();
  });

  app.get('/me/interests', async (request) => ({ items: await users.getInterests(request.auth.userId) }));

  app.put('/me/interests', { schema: { body: InterestsBody } }, async (request) => ({
    items: await users.setInterests(request.auth.userId, request.body.fields),
  }));

  app.get('/me/follow-requests', { schema: { querystring: pageQuery } }, async (request) =>
    users.listFollowRequests(request.auth.userId, request.query),
  );

  app.post('/me/follow-requests/:id/accept', { schema: { params: idParams } }, async (request, reply) => {
    await users.acceptFollowRequest(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/me/follow-requests/:id', { schema: { params: idParams } }, async (request, reply) => {
    await users.declineFollowRequest(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.get('/me/blocks', { schema: { querystring: pageQuery } }, async (request) =>
    users.listBlocks(request.auth.userId, request.query),
  );

  // ----- Other people -----
  app.get(
    '/users/suggestions',
    { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) } },
    async (request) => ({ items: await users.suggestUsers(request.auth.userId, request.query.limit) }),
  );

  app.get('/users/:id', { schema: { params: idParams } }, async (request) =>
    users.getProfile(request.auth.userId, request.params.id),
  );

  // { status: "accepted" } for a public account, { status: "pending" } for a request to a private one.
  app.put('/users/:id/follow', { schema: { params: idParams } }, async (request) =>
    users.follow(request.auth.userId, request.params.id),
  );

  app.delete('/users/:id/follow', { schema: { params: idParams } }, async (request, reply) => {
    await users.unfollow(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.put('/users/:id/block', { schema: { params: idParams } }, async (request, reply) => {
    await users.block(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/users/:id/block', { schema: { params: idParams } }, async (request, reply) => {
    await users.unblock(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
