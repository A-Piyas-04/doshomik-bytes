import { MEDIA_KINDS, MEDIA_PURPOSES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParams } from '../../lib/validation';
import * as media from './media.service';

const CreateUploadBody = z.object({
  kind: z.enum(MEDIA_KINDS),
  // Uploading with purpose "avatar" sets the image as your avatar once it is processed.
  purpose: z.enum(MEDIA_PURPOSES),
  mime_type: z.string().max(100),
  size_bytes: z.number().int().positive(),
});

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/media/uploads', { schema: { body: CreateUploadBody } }, async (request, reply) => {
    const upload = await media.createUpload(request.auth, request.body);
    return reply.status(201).send(upload);
  });

  app.post('/media/:id/complete', { schema: { params: idParams } }, async (request) =>
    media.completeUpload(request.auth.userId, request.params.id),
  );

  app.get('/media/:id', { schema: { params: idParams } }, async (request) =>
    media.getOwnMedia(request.auth.userId, request.params.id),
  );
};
