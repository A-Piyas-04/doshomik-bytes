import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { perUser } from '../../lib/rate-limits';
import { idParams, publicId, text } from '../../lib/validation';
import * as comments from './comments.service';

const CreateCommentBody = z.object({
  body: text(2000),
  parent_id: publicId.optional(),
});

// Post comments and paper discussion share one table and one set of endpoints.
const threads = [
  { path: '/posts/:id/comments', target: (id: string) => ({ postId: id }) },
  { path: '/papers/:id/comments', target: (id: string) => ({ paperId: id }) },
] as const;

export const commentRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const thread of threads) {
    app.get(thread.path, { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
      comments.listComments(request.auth.userId, thread.target(request.params.id), request.query),
    );

    app.post(
      thread.path,
      { config: perUser(30), schema: { params: idParams, body: CreateCommentBody } },
      async (request, reply) => {
        const { body, parent_id } = request.body;
        const comment = await comments.addComment(request.auth.userId, thread.target(request.params.id), body, parent_id);
        return reply.status(201).send(comment);
      },
    );
  }

  app.get('/comments/:id/replies', { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
    comments.listReplies(request.auth.userId, request.params.id, request.query),
  );

  app.delete('/comments/:id', { schema: { params: idParams } }, async (request, reply) => {
    await comments.deleteComment(request.auth.userId, request.params.id);
    return reply.status(204).send();
  });
};
