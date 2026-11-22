import { describe, expect, it } from 'vitest';
import { call, createUser, runWorker, sent, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();

const textPost = async (user: TestUser, caption: string) => (await call(ctx.app, user, 'POST', '/v1/posts', { type: 'text', caption })).body;
const notificationTypes = async (user: TestUser) =>
  (await call(ctx.app, user, 'GET', '/v1/notifications')).body.items.map((n: { type: string }) => n.type);

describe('following', () => {
  it('follows a public account at once and shows its posts on Home', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    expect((await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`)).body).toEqual({ status: 'accepted' });

    for (const caption of ['one', 'two', 'three']) await textPost(bina, caption);
    const page1 = (await call(ctx.app, ali, 'GET', '/v1/feed?limit=2')).body;
    expect(page1.items.map((p: { caption: string }) => p.caption)).toEqual(['three', 'two']);
    const page2 = (await call(ctx.app, ali, 'GET', `/v1/feed?limit=2&cursor=${page1.next_cursor}`)).body;
    expect(page2.items.map((p: { caption: string }) => p.caption)).toEqual(['one']);

    await runWorker();
    expect(await notificationTypes(bina)).toEqual(['follow']);
  });

  it('sends a follow request to a private account, which hides posts until accepted', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    await call(ctx.app, bina, 'PATCH', '/v1/me', { is_private: true });
    const post = await textPost(bina, 'for followers only');

    expect((await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`)).body).toEqual({ status: 'pending' });
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).body).toMatchObject({ is_private: true, follow_status: 'pending' });
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(404);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}/posts`)).body.items).toHaveLength(0);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}/papers`)).body).toEqual({ saved: [], reading: [], completed: [] });

    await runWorker();
    expect(await notificationTypes(bina)).toEqual(['follow_request']);
    const requests = (await call(ctx.app, bina, 'GET', '/v1/me/follow-requests')).body.items;
    expect(requests).toMatchObject([{ id: ali.id, username: 'ali' }]);

    expect((await call(ctx.app, bina, 'POST', `/v1/me/follow-requests/${ali.id}/accept`)).status).toBe(204);
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(200);
    expect((await call(ctx.app, ali, 'GET', '/v1/feed')).body.items).toHaveLength(1);
  });
});

describe('likes and comments', () => {
  it('updates stored counters and notifies through the worker', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const chandra = await createUser(ctx.app, 'chandra');
    await call(ctx.app, bina, 'PUT', '/v1/sessions/current/push-token', { push_token: 'fcm-token-bina' });
    const post = await textPost(bina, 'What is attention?');

    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/like`);
    const top = (await call(ctx.app, ali, 'POST', `/v1/posts/${post.id}/comments`, { body: 'Great question' })).body;
    await call(ctx.app, chandra, 'POST', `/v1/posts/${post.id}/comments`, { body: 'Agreed', parent_id: top.id });

    // Counters are the worker's job: right after the request they haven't moved yet.
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body).toMatchObject({ like_count: 0, liked_by_me: true });
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body).toMatchObject({ like_count: 1, comment_count: 2 });

    expect(await notificationTypes(bina)).toEqual(['comment', 'comment', 'like']);
    expect(await notificationTypes(ali)).toEqual(['reply']);
    expect(sent.pushes.filter((p) => p.tokens.includes('fcm-token-bina'))).toHaveLength(3);
  });

  it('keeps a deleted comment as a placeholder so its replies survive', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(ali, 'Thread');
    const top = (await call(ctx.app, bina, 'POST', `/v1/posts/${post.id}/comments`, { body: 'First' })).body;
    await call(ctx.app, ali, 'POST', `/v1/posts/${post.id}/comments`, { body: 'Reply', parent_id: top.id });

    expect((await call(ctx.app, ali, 'DELETE', `/v1/comments/${top.id}`)).status).toBe(403);
    expect((await call(ctx.app, bina, 'DELETE', `/v1/comments/${top.id}`)).status).toBe(204);

    const list = (await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}/comments`)).body.items;
    expect(list).toMatchObject([{ id: top.id, is_deleted: true, body: null, author: null, reply_count: 1 }]);
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body.comment_count).toBe(1);
  });

  it('saves posts and soft-deletes them', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(bina, 'Keep this');

    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/save`);
    expect((await call(ctx.app, ali, 'GET', '/v1/me/saved')).body.items).toMatchObject([{ id: post.id, saved_by_me: true }]);

    expect((await call(ctx.app, ali, 'DELETE', `/v1/posts/${post.id}`)).status).toBe(403);
    expect((await call(ctx.app, bina, 'DELETE', `/v1/posts/${post.id}`)).status).toBe(204);
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(404);
    expect((await call(ctx.app, ali, 'GET', '/v1/me/saved')).body.items).toHaveLength(0);
  });
});

describe('blocking', () => {
  it('hides each user from the other everywhere and ends follows', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`);
    const post = await textPost(bina, 'transformer notes');

    expect((await call(ctx.app, bina, 'PUT', `/v1/users/${ali.id}/block`)).status).toBe(204);

    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).status).toBe(404);
    expect((await call(ctx.app, bina, 'GET', `/v1/users/${ali.id}`)).status).toBe(404);
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(404);
    expect((await call(ctx.app, ali, 'GET', '/v1/feed')).body.items).toHaveLength(0);
    expect((await call(ctx.app, ali, 'GET', '/v1/search?q=bina')).body.users).toHaveLength(0);
    expect((await call(ctx.app, ali, 'GET', '/v1/search?q=transformer')).body.posts).toHaveLength(0);
    expect((await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`)).status).toBe(404);

    expect((await call(ctx.app, bina, 'GET', '/v1/me/blocks')).body.items).toMatchObject([{ user: { id: ali.id } }]);
    await call(ctx.app, bina, 'DELETE', `/v1/users/${ali.id}/block`);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).status).toBe(200);
  });
});

describe('reports and moderation', () => {
  it('queues a report once, and a moderator removes the content', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const spammer = await createUser(ctx.app, 'spammer');
    const moderator = await createUser(ctx.app, 'mod', { role: 'moderator' });
    const post = await textPost(spammer, 'buy followers now');

    const report = { target_type: 'post', target_id: post.id, reason: 'spam' };
    expect((await call(ctx.app, ali, 'POST', '/v1/reports', report)).status).toBe(201);
    expect((await call(ctx.app, ali, 'POST', '/v1/reports', report)).status).toBe(200); // already open

    const queue = (await call(ctx.app, moderator, 'GET', '/v1/admin/reports')).body.items;
    expect(queue).toMatchObject([{ reason: 'spam', reporter: 'ali', target: { id: post.id, caption: 'buy followers now' } }]);
    // Moderators can't reach content admin routes.
    expect((await call(ctx.app, moderator, 'GET', '/v1/admin/papers')).status).toBe(403);

    expect((await call(ctx.app, moderator, 'POST', `/v1/admin/reports/${queue[0].id}/resolve`, { action: 'remove_content' })).status).toBe(204);
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(404);
    expect((await call(ctx.app, moderator, 'GET', '/v1/admin/reports')).body.items).toHaveLength(0);
  });

  it('suspends an account, which signs it out at once', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const troll = await createUser(ctx.app, 'troll');
    const moderator = await createUser(ctx.app, 'mod', { role: 'moderator' });
    await call(ctx.app, ali, 'POST', '/v1/reports', { target_type: 'user', target_id: troll.id, reason: 'harassment' });

    const [report] = (await call(ctx.app, moderator, 'GET', '/v1/admin/reports')).body.items;
    await call(ctx.app, moderator, 'POST', `/v1/admin/reports/${report.id}/resolve`, { action: 'suspend_user' });

    expect((await call(ctx.app, troll, 'GET', '/v1/me')).status).toBe(401);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${troll.id}`)).status).toBe(404);
  });
});
