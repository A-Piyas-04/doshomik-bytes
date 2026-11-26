import { POST_TYPES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { perUser } from '../../lib/rate-limits';
import { idParams, optionalText, publicId, slug } from '../../lib/validation';
import * as posts from './posts.service';

const CreatePostBody = z.object({
  type: z.enum(POST_TYPES),
  caption: optionalText(2200),
  media_id: publicId.optional(), // from POST /v1/media/uploads, after /complete
  topic: slug.optional(), // concept tag (a topic slug), used to link reels from Learn before reading
});

export const postRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/feed', { schema: { querystring: pageQuery } }, async (request) => posts.listFeed(request.auth.userId, request.query));

  app.get('/reels', { schema: { querystring: pageQuery } }, async (request) => posts.listReels(request.auth.userId, request.query));

  app.get('/explore', { schema: { querystring: pageQuery.extend({ field: slug.optional() }) } }, async (request) => {
    const { field, ...page } = request.query;
    return posts.listExplore(request.auth.userId, { field }, page);
  });

  app.get('/users/:id/posts', { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
    posts.listUserPosts(request.auth.userId, request.params.id, request.query),
  );

  app.get('/me/saved', { schema: { querystring: pageQuery } }, async (request) =>
    posts.listSavedPosts(request.auth.userId, request.query),
  );

  app.post('/posts', { config: perUser(20), schema: { body: CreatePostBody } }, async (request, reply) => {
    const post = await posts.createPost(request.auth.userId, { ...request.body, caption: request.body.caption ?? null });
    return reply.status(201).send(post);
  });

  app.get('/posts/:id', { schema: { params: idParams } }, async (request) => posts.getPost(request.auth.userId, request.params.id));

  app.delete('/posts/:id', { schema: { params: idParams } }, async (request, reply) => {
    await posts.deletePost(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.put('/posts/:id/like', { config: perUser(120), schema: { params: idParams } }, async (request, reply) => {
    await posts.likePost(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/posts/:id/like', { schema: { params: idParams } }, async (request, reply) => {
    await posts.unlikePost(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.put('/posts/:id/save', { schema: { params: idParams } }, async (request, reply) => {
    await posts.savePost(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/posts/:id/save', { schema: { params: idParams } }, async (request, reply) => {
    await posts.unsavePost(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
