import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();

// A valid 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A tiny black MP4 of the given length, made with ffmpeg. */
function makeVideo(dir: string, seconds: number): Buffer {
  const file = path.join(dir, `${seconds}s.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=32x32:r=1:d=${seconds}`, '-c:v', 'mpeg4', '-y', file]);
  return readFileSync(file);
}

function postForm(type: string, file?: { bytes: Buffer; mimetype: string; name: string }, caption?: string) {
  const form = new FormData();
  form.append('type', type);
  if (caption) form.append('caption', caption);
  if (file) form.append('media', new Blob([file.bytes], { type: file.mimetype }), file.name);
  return form;
}

const createPost = (user: TestUser, form: FormData) =>
  ctx.app.inject({ method: 'POST', url: '/posts', headers: user.headers, payload: form });

describe('image posts and avatars', () => {
  it('stores an image post and serves the file', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const response = await createPost(ali, postForm('image', { bytes: PNG, mimetype: 'image/png', name: 'a.png' }, 'A figure'));

    expect(response.statusCode).toBe(201);
    const post = response.json();
    expect(post).toMatchObject({ type: 'image', caption: 'A figure', duration_seconds: null });

    const served = await ctx.app.inject({ method: 'GET', url: new URL(post.media_url).pathname });
    expect(served.statusCode).toBe(200);
  });

  it('rejects a file whose content is not the image it claims to be', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const fake = { bytes: Buffer.from('not really a png'), mimetype: 'image/png', name: 'fake.png' };

    const response = await createPost(ali, postForm('image', fake));
    expect(response.json().error.code).toBe('INVALID_IMAGE');
  });

  it('rejects an image post without a file and an unsupported file type', async () => {
    const ali = await createUser(ctx.app, 'ali');
    expect((await createPost(ali, postForm('image'))).statusCode).toBe(400);

    const gif = { bytes: Buffer.from('GIF89a'), mimetype: 'image/gif', name: 'a.gif' };
    expect((await createPost(ali, postForm('image', gif))).statusCode).toBe(415);
  });

  it('sets the avatar', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const form = new FormData();
    form.append('avatar', new Blob([PNG], { type: 'image/png' }), 'me.png');

    const response = await ctx.app.inject({ method: 'PUT', url: '/me/avatar', headers: ali.headers, payload: form });
    expect(response.json().avatar_url).toMatch(/\/media\/avatars\/.+\.png$/);
  });
});

describe.skipIf(!hasFfmpeg())('reels', () => {
  let videoDir: string;
  beforeAll(() => {
    videoDir = mkdtempSync(path.join(os.tmpdir(), 'doshomik-videos-'));
  });

  it('accepts a reel up to 90 seconds and lists it on the Reels page', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const video = { bytes: makeVideo(videoDir, 5), mimetype: 'video/mp4', name: 'clip.mp4' };

    const response = await createPost(ali, postForm('reel', video, 'Attention in 5 seconds'));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ type: 'reel', duration_seconds: 5 });

    const reels = (await ctx.app.inject({ method: 'GET', url: '/reels', headers: ali.headers })).json();
    expect(reels.items).toHaveLength(1);
  });

  it('rejects a reel longer than 90 seconds', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const video = { bytes: makeVideo(videoDir, 91), mimetype: 'video/mp4', name: 'long.mp4' };

    const response = await createPost(ali, postForm('reel', video));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VIDEO_TOO_LONG');
  });
});
