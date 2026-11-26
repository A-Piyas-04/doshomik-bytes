import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
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

  it('toggles a follow without re-notifying, and keeps stored counts right', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`);
    expect((await call(ctx.app, ali, 'DELETE', `/v1/users/${bina.id}/follow`)).status).toBe(204);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).body).toMatchObject({ follow_status: 'none' });
    expect((await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`)).body).toEqual({ status: 'accepted' });

    await runWorker();
    expect(await notificationTypes(bina)).toEqual(['follow']);
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).body).toMatchObject({ followers_count: 1, follow_status: 'accepted' });
    expect((await call(ctx.app, bina, 'GET', `/v1/users/${ali.id}`)).body).toMatchObject({ following_count: 1 });

    await call(ctx.app, ali, 'DELETE', `/v1/users/${bina.id}/follow`);
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/users/${bina.id}`)).body).toMatchObject({ followers_count: 0 });
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

  it('toggles a like on one row: like → unlike → like counts once and notifies once', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(bina, 'Toggle me');

    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/like`);
    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/like`); // already liked: no change
    await call(ctx.app, ali, 'DELETE', `/v1/posts/${post.id}/like`);
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body).toMatchObject({ liked_by_me: false });
    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/like`);
    await runWorker();

    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body).toMatchObject({ like_count: 1, liked_by_me: true });
    expect(await notificationTypes(bina)).toEqual(['like']);

    await call(ctx.app, ali, 'DELETE', `/v1/posts/${post.id}/like`);
    await runWorker();
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).body).toMatchObject({ like_count: 0, liked_by_me: false });
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

  it('keeps one row per pair: unblock deactivates it and a reblock reactivates it', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(bina, 'block toggles');
    const rows = () => db.selectFrom('blocks').select(['is_active', 'created_at', 'updated_at']).execute();

    expect((await call(ctx.app, bina, 'PUT', `/v1/users/${ali.id}/block`)).status).toBe(204);
    expect((await call(ctx.app, bina, 'PUT', `/v1/users/${ali.id}/block`)).status).toBe(204); // already blocked: no change
    const [first] = await rows();
    expect(first).toMatchObject({ is_active: true });

    expect((await call(ctx.app, bina, 'DELETE', `/v1/users/${ali.id}/block`)).status).toBe(204);
    const [unblocked] = await rows();
    expect(unblocked).toMatchObject({ is_active: false, created_at: first!.created_at });
    expect(unblocked!.updated_at.getTime()).toBeGreaterThanOrEqual(first!.updated_at.getTime());
    // An inactive row hides nothing and is not listed.
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(200);
    expect((await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/follow`)).body).toEqual({ status: 'accepted' });
    expect((await call(ctx.app, ali, 'GET', '/v1/feed')).body.items).toHaveLength(1);
    expect((await call(ctx.app, bina, 'GET', '/v1/me/blocks')).body.items).toHaveLength(0);

    expect((await call(ctx.app, bina, 'PUT', `/v1/users/${ali.id}/block`)).status).toBe(204);
    const reblocked = await rows();
    expect(reblocked).toHaveLength(1);
    expect(reblocked[0]).toMatchObject({ is_active: true, created_at: first!.created_at });
    expect((await call(ctx.app, ali, 'GET', `/v1/posts/${post.id}`)).status).toBe(404);
    expect((await call(ctx.app, ali, 'GET', '/v1/feed')).body.items).toHaveLength(0); // the follow ended again
    const listed = (await call(ctx.app, bina, 'GET', '/v1/me/blocks')).body.items;
    expect(listed).toMatchObject([{ user: { id: ali.id } }]);
    expect(new Date(listed[0].blocked_at).getTime()).toBe(reblocked[0]!.updated_at.getTime()); // when this block began
  });

  it('sends no notifications across an active block, and does again after unblocking', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(bina, 'notify me');
    await call(ctx.app, bina, 'PUT', `/v1/users/${ali.id}/block`);
    await call(ctx.app, bina, 'DELETE', `/v1/users/${ali.id}/block`);

    await call(ctx.app, ali, 'PUT', `/v1/posts/${post.id}/like`);
    await runWorker();
    expect(await notificationTypes(bina)).toEqual(['like']);
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

  it('checks that each kind of target exists and may be reported', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(bina, 'a post');
    const comment = (await call(ctx.app, bina, 'POST', `/v1/posts/${post.id}/comments`, { body: 'a comment' })).body;
    const missing = '00000000-0000-4000-8000-000000000000';
    const report = (target_type: string, target_id: string, user = ali) =>
      call(ctx.app, user, 'POST', '/v1/reports', { target_type, target_id, reason: 'spam' });

    for (const type of ['user', 'post', 'comment', 'trail']) expect((await report(type, missing)).status).toBe(404);
    // A real id of the wrong kind is not found either: target_id is only looked up in its type's table.
    expect((await report('comment', post.id)).status).toBe(404);
    expect((await report('user', ali.id)).body.error.code).toBe('SELF_REPORT');

    expect((await report('comment', comment.id)).status).toBe(201);
    expect((await report('user', bina.id)).status).toBe(201);
    const stored = await db.selectFrom('reports').select(['target_type', 'target_id']).orderBy('id').execute();
    const ids = await db.selectFrom('comments').select('id').union(db.selectFrom('users').select('id').where('username', '=', 'bina')).execute();
    expect(stored.map((r) => r.target_type)).toEqual(['comment', 'user']);
    expect(stored.map((r) => r.target_id).sort()).toEqual(ids.map((r) => r.id).sort());

    // Not eligible: a deleted comment, a comment in a thread the reporter can't see, a suspended user.
    const hidden = (await call(ctx.app, bina, 'POST', `/v1/posts/${post.id}/comments`, { body: 'soon hidden' })).body;
    await call(ctx.app, bina, 'PATCH', '/v1/me', { is_private: true });
    expect((await report('comment', hidden.id)).status).toBe(404);
    await call(ctx.app, bina, 'PATCH', '/v1/me', { is_private: false });
    await call(ctx.app, bina, 'DELETE', `/v1/comments/${hidden.id}`);
    expect((await report('comment', hidden.id)).status).toBe(404);
    // Blocking a harasser doesn't stop you reporting their comment on someone else's post.
    const cara = await createUser(ctx.app, 'cara');
    const carasPost = await textPost(cara, 'open thread');
    const abuse = (await call(ctx.app, bina, 'POST', `/v1/posts/${carasPost.id}/comments`, { body: 'abuse' })).body;
    await call(ctx.app, ali, 'PUT', `/v1/users/${bina.id}/block`);
    expect((await report('comment', abuse.id)).status).toBe(201);
    expect((await report('user', bina.id)).status).toBe(200); // still reportable, and already open

    await db.updateTable('users').set({ status: 'suspended' }).where('public_id', '=', bina.id).execute();
    expect((await report('user', bina.id)).status).toBe(404);
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
