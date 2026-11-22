import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createUser, runWorker, upload, useTestApp } from './helpers';

const ctx = useTestApp();

/** A JPEG carrying EXIF metadata, standing in for a phone photo with GPS. */
const photoWithExif = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366ff' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'camera owner', Make: 'PhoneCo' } })
    .toBuffer();

const fetchMedia = (url: string) => ctx.app.inject({ method: 'GET', url: new URL(url).pathname });

describe('upload slots', () => {
  it('checks the declared file and only accepts the bytes through the signed URL', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const slot = (payload: object) => call(ctx.app, ali, 'POST', '/v1/media/uploads', payload);

    expect((await slot({ kind: 'image', purpose: 'post', mime_type: 'image/gif', size_bytes: 10 })).body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await slot({ kind: 'image', purpose: 'post', mime_type: 'image/png', size_bytes: 50 * 1024 * 1024 })).body.error.code).toBe('FILE_TOO_LARGE');
    expect((await slot({ kind: 'video', purpose: 'avatar', mime_type: 'video/mp4', size_bytes: 10 })).status).toBe(400);
    expect((await slot({ kind: 'image', purpose: 'learn', mime_type: 'image/png', size_bytes: 10 })).status).toBe(403); // staff only

    const { body } = await slot({ kind: 'image', purpose: 'post', mime_type: 'image/jpeg', size_bytes: 4 });
    expect((await call(ctx.app, ali, 'POST', `/v1/media/${body.media.id}/complete`)).body.error.code).toBe('UPLOAD_MISSING');

    const target = new URL(body.upload.url).pathname;
    const wrongType = await ctx.app.inject({ method: 'PUT', url: target, headers: { 'content-type': 'image/png' }, payload: Buffer.from('abcd') });
    expect(wrongType.statusCode).toBe(400);
    const tooBig = await ctx.app.inject({ method: 'PUT', url: target, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.alloc(100) });
    expect(tooBig.statusCode).toBe(413);
    const forged = await ctx.app.inject({ method: 'PUT', url: `${target}x`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from('abcd') });
    expect(forged.statusCode).toBe(403);

    const bina = await createUser(ctx.app, 'bina');
    expect((await call(ctx.app, bina, 'GET', `/v1/media/${body.media.id}`)).status).toBe(404); // someone else's upload
  });
});

describe('image posts', () => {
  it('waits as processing, then publishes with WebP variants and no metadata', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const mediaId = await upload(ctx.app, ali, { kind: 'image', purpose: 'post', mimeType: 'image/jpeg', bytes: await photoWithExif() });

    const created = await call(ctx.app, ali, 'POST', '/v1/posts', { type: 'image', caption: 'Gradient descent', media_id: mediaId });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'processing', media: { id: mediaId, status: 'processing', url: null } });
    expect((await call(ctx.app, bina, 'GET', `/v1/posts/${created.body.id}`)).status).toBe(404); // not live yet

    await runWorker();
    const post = (await call(ctx.app, bina, 'GET', `/v1/posts/${created.body.id}`)).body;
    expect(post).toMatchObject({ status: 'published', media: { status: 'ready', width: 64, height: 48 } });
    expect((await call(ctx.app, ali, 'GET', '/v1/notifications')).body.items).toMatchObject([{ type: 'post_ready' }]);

    const image = await fetchMedia(post.media.url);
    expect(image.statusCode).toBe(200);
    expect(image.headers['cache-control']).toMatch(/^private, max-age=\d+/);
    const metadata = await sharp(image.rawPayload).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();

    // The signature covers this asset only.
    const otherKey = new URL(post.media.url).pathname.replace(/posts\/[^/]+\//, 'posts/someone-else/');
    expect((await ctx.app.inject({ method: 'GET', url: otherKey })).statusCode).toBe(403);
  });

  it('rejects a file that is not really an image', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const mediaId = await upload(ctx.app, ali, { kind: 'image', purpose: 'post', mimeType: 'image/png', bytes: Buffer.from('not a png') });
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/media/${mediaId}`)).body).toMatchObject({ status: 'failed', error: 'File is not a readable image' });
    expect((await call(ctx.app, ali, 'POST', '/v1/posts', { type: 'image', media_id: mediaId })).body.error.code).toBe('MEDIA_NOT_READY');
  });

  it('sets the avatar from an avatar upload once processed', async () => {
    const ali = await createUser(ctx.app, 'ali');
    await upload(ctx.app, ali, { kind: 'image', purpose: 'avatar', mimeType: 'image/jpeg', bytes: await photoWithExif() });
    await runWorker();
    const { avatar_url } = (await call(ctx.app, ali, 'GET', '/v1/me')).body;
    expect(avatar_url).toMatch(/\/media\/public\/avatar\/.+\/thumb\.webp$/);
    const served = await fetchMedia(avatar_url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toContain('immutable');
  });
});

describe.skipIf(!hasFfmpeg())('reels', () => {
  let videoDir: string;
  beforeAll(() => {
    videoDir = mkdtempSync(path.join(os.tmpdir(), 'doshomik-videos-'));
  });

  /** A tiny black MP4 of the given length. */
  function makeVideo(seconds: number): Buffer {
    const file = path.join(videoDir, `${seconds}s.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=64x112:r=5:d=${seconds}`, '-c:v', 'mpeg4', '-y', file]);
    return readFileSync(file);
  }

  it('transcodes a reel to HLS with a poster and plays it through signed URLs', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const mediaId = await upload(ctx.app, ali, { kind: 'video', purpose: 'post', mimeType: 'video/mp4', bytes: makeVideo(5) });
    const created = (await call(ctx.app, ali, 'POST', '/v1/posts', { type: 'reel', caption: 'Attention in 5 seconds', media_id: mediaId })).body;

    await runWorker();
    const reel = (await call(ctx.app, ali, 'GET', '/v1/reels')).body.items[0];
    expect(reel).toMatchObject({ id: created.id, status: 'published', media: { kind: 'video', duration_seconds: 5, width: 64, height: 112 } });

    const master = await fetchMedia(reel.media.url);
    expect(master.statusCode).toBe(200);
    const variant = master.body.split('\n').find((line) => line.endsWith('.m3u8'))!;
    const variantPlaylist = await fetchMedia(new URL(variant, reel.media.url).toString());
    const segment = variantPlaylist.body.split('\n').find((line) => line.endsWith('.ts'))!;
    expect((await fetchMedia(new URL(segment, new URL(variant, reel.media.url)).toString())).statusCode).toBe(200);
    expect((await fetchMedia(reel.media.thumbnail_url)).statusCode).toBe(200);
  });

  it('fails a reel longer than 90 seconds, whatever the app claimed', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const mediaId = await upload(ctx.app, ali, { kind: 'video', purpose: 'post', mimeType: 'video/mp4', bytes: makeVideo(91) });
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/media/${mediaId}`)).body).toMatchObject({
      status: 'failed',
      error: 'Reels can be at most 90 seconds long',
    });
  });
});

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
