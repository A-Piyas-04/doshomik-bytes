import { POST_TYPES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { discardUpload, readMultipart } from '../../lib/uploads';
import { idParams, optionalText } from '../../lib/validation';
import * as posts from './posts.service';

const CreatePostFields = z.object({
  type: z.enum(POST_TYPES),
  caption: optionalText(2200),
});

export const postRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/feed', { schema: { querystring: pageQuery } }, async (request) =>
    posts.listFeed(request.user.id, request.query),
  );

  app.get('/reels', { schema: { querystring: pageQuery } }, async (request) =>
    posts.listReels(request.user.id, request.query),
  );

  app.get('/users/:id/posts', { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
    posts.listUserPosts(request.user.id, request.params.id, request.query),
  );

  // Image and reel posts: multipart/form-data with `type`, optional `caption` and one file.
  // Text posts may also send a JSON body: { type: "text", caption }.
  app.post('/posts', async (request, reply) => {
    const { fields, file } = request.isMultipart()
      ? await readMultipart(request, ['image', 'video'])
      : { fields: request.body, file: undefined };

    const parsed = CreatePostFields.safeParse(fields);
    if (!parsed.success) {
      await discardUpload(file);
      throw parsed.error;
    }

    const post = await posts.createPost(request.user.id, { ...parsed.data, caption: parsed.data.caption ?? null, file });
    return reply.status(201).send(post);
  });

  app.get('/posts/:id', { schema: { params: idParams } }, async (request) =>
    posts.getPost(request.user.id, request.params.id),
  );

  app.delete('/posts/:id', { schema: { params: idParams } }, async (request, reply) => {
    await posts.deletePost(request.user.id, request.params.id);
    return reply.status(204).send();
  });

  app.put('/posts/:id/like', { schema: { params: idParams } }, async (request, reply) => {
    await posts.likePost(request.user.id, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/posts/:id/like', { schema: { params: idParams } }, async (request, reply) => {
    await posts.unlikePost(request.user.id, request.params.id);
    return reply.status(204).send();
  });
};
