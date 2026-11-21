import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageQuery } from '../../lib/pagination';
import { id, idParams, text } from '../../lib/validation';
import * as comments from './comments.service';

const CreateCommentBody = z.object({
  body: text(2000),
  parent_id: id.optional(),
});

// Post comments and paper discussion share one table and one set of endpoints.
const threads = [
  { path: '/posts/:id/comments', target: (id: number) => ({ postId: id }) },
  { path: '/papers/:id/comments', target: (id: number) => ({ paperId: id }) },
] as const;

export const commentRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const thread of threads) {
    app.get(thread.path, { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
      comments.listComments(thread.target(request.params.id), request.query),
    );

    app.post(thread.path, { schema: { params: idParams, body: CreateCommentBody } }, async (request, reply) => {
      const { body, parent_id } = request.body;
      const comment = await comments.addComment(request.user.id, thread.target(request.params.id), body, parent_id);
      return reply.status(201).send(comment);
    });
  }

  app.get('/comments/:id/replies', { schema: { params: idParams, querystring: pageQuery } }, async (request) =>
    comments.listReplies(request.params.id, request.query),
  );
};
