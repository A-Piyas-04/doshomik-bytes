import { sql } from 'kysely';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { purgeDeletedAccounts } from '../src/worker/maintenance';
import { call, createUser, useTestApp } from './helpers';

const ctx = useTestApp();

describe('account deletion', () => {
  it('hides the account at once and signs out every device', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    expect((await call(ctx.app, ali, 'DELETE', '/v1/me', { password: 'wrong-password' })).status).toBe(401);
    expect((await call(ctx.app, ali, 'DELETE', '/v1/me', { password: 'password123' })).status).toBe(204);

    expect((await call(ctx.app, ali, 'GET', '/v1/me')).status).toBe(401);
    expect((await call(ctx.app, bina, 'GET', `/v1/users/${ali.id}`)).status).toBe(404);
    const login = await call(ctx.app, null, 'POST', '/v1/auth/login', { login: 'ali', password: 'password123', platform: 'android' });
    expect(login.status).toBe(401);
  });

  it('purges the data after the grace period but keeps reply threads as "[deleted]"', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = (await call(ctx.app, bina, 'POST', '/v1/posts', { type: 'text', caption: 'Question' })).body;
    const aliComment = (await call(ctx.app, ali, 'POST', `/v1/posts/${post.id}/comments`, { body: 'my words' })).body;
    await call(ctx.app, bina, 'POST', `/v1/posts/${post.id}/comments`, { body: 'Thanks!', parent_id: aliComment.id });
    await call(ctx.app, ali, 'POST', '/v1/posts', { type: 'text', caption: 'ali post' });

    await call(ctx.app, ali, 'DELETE', '/v1/me', { password: 'password123' });
    expect(await purgeDeletedAccounts(pino({ level: 'silent' }))).toBe(0); // still in the grace period

    await sql`UPDATE users SET deleted_at = now() - interval '31 days' WHERE public_id = ${ali.id}`.execute(db);
    expect(await purgeDeletedAccounts(pino({ level: 'silent' }))).toBe(1);

    expect(await db.selectFrom('users').select('id').where('public_id', '=', ali.id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('posts').select('id').where('caption', '=', 'ali post').executeTakeFirst()).toBeUndefined();
    const stored = await db.selectFrom('comments').select(['user_id', 'body']).where('public_id', '=', aliComment.id).executeTakeFirstOrThrow();
    expect(stored).toEqual({ user_id: null, body: '' }); // the text is gone, the row holds the thread

    const thread = (await call(ctx.app, bina, 'GET', `/v1/posts/${post.id}/comments`)).body.items;
    expect(thread).toMatchObject([{ id: aliComment.id, is_deleted: true, body: null, author: null, reply_count: 1 }]);
    expect((await call(ctx.app, bina, 'GET', `/v1/comments/${aliComment.id}/replies`)).body.items).toMatchObject([{ body: 'Thanks!' }]);
  });
});

describe('app config and deep links', () => {
  it('reports the minimum supported app version without signing in', async () => {
    expect((await call(ctx.app, null, 'GET', '/v1/app/config')).body).toEqual({ min_version: { android: '0.0.0', ios: '0.0.0' } });
  });
});
