import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';
import { verifyToken } from '../../lib/crypto';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { localStorage } from '../../lib/storage';

// The HTTP side of LocalDiskStorage: what S3/R2 (signed PUT uploads) and the CDN (media delivery)
// do in production. Not under /v1 because it is storage, not API.

export const storageRoutes: FastifyPluginAsync = async (app) => {
  // Upload bodies are raw file bytes, streamed straight to disk.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.put<{ Params: { token: string } }>('/storage/raw/:token', async (request) => {
    const grant = verifyToken<{ k: string; t: string; m: number }>('upload', request.params.token);
    if (!grant) throw forbidden('Upload link is invalid or has expired');
    if (request.headers['content-type'] !== grant.t) throw badRequest(`Content-Type must be ${grant.t}`);
    const size = await localStorage.writeRaw(grant.k, request.raw, grant.m);
    return { size };
  });

  // reply.sendFile() for signed media, from anywhere under processed/. Serves nothing by itself.
  await app.register(fastifyStatic, { root: localStorage.processedDir, serve: false });

  // Public files (avatars, learn media, paper figures) need no signature. Keys never change content.
  await app.register(fastifyStatic, {
    root: path.join(localStorage.processedDir, 'public'),
    prefix: '/media/public/',
    decorateReply: false,
    index: false,
    immutable: true,
    maxAge: '365d',
  });

  // Signed post media. The token covers a folder, so an HLS manifest's relative segment URLs work too.
  app.get<{ Params: { token: string; '*': string } }>('/media/s/:token/*', async (request, reply) => {
    const grant = verifyToken<{ p: string; exp: number }>('media', request.params.token);
    const key = request.params['*'];
    if (!grant || !key.startsWith(grant.p) || key.includes('..')) throw forbidden('Media link is invalid or has expired');
    if (!localStorage.processedPath(key)) throw notFound('File');

    const secondsLeft = Math.max(0, grant.exp - Math.floor(Date.now() / 1000));
    reply.header('cache-control', `private, max-age=${secondsLeft}`);
    return reply.sendFile(key, { cacheControl: false });
  });
};
