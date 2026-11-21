import { describe, expect, it } from 'vitest';
import { createUser, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();

const textPost = async (user: TestUser, caption: string) =>
  (await ctx.app.inject({ method: 'POST', url: '/posts', headers: user.headers, payload: { type: 'text', caption } })).json();

const notificationsOf = async (user: TestUser) =>
  (await ctx.app.inject({ method: 'GET', url: '/notifications', headers: user.headers })).json().items;

describe('follow', () => {
  it('notifies once, and rejects following yourself', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    for (let i = 0; i < 2; i++) {
      const response = await ctx.app.inject({ method: 'PUT', url: `/users/${ali.id}/follow`, headers: bina.headers });
      expect(response.statusCode).toBe(204);
    }
    const notifications = await notificationsOf(ali);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: 'follow', actor: { username: 'bina' }, is_read: false });

    const self = await ctx.app.inject({ method: 'PUT', url: `/users/${ali.id}/follow`, headers: ali.headers });
    expect(self.json().error.code).toBe('SELF_FOLLOW');
  });

  it('suggests people the user does not follow yet', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    await createUser(ctx.app, 'chandra');
    await ctx.app.inject({ method: 'PUT', url: `/users/${bina.id}/follow`, headers: ali.headers });

    const response = await ctx.app.inject({ method: 'GET', url: '/users/suggestions', headers: ali.headers });
    expect(response.json().items.map((u: { username: string }) => u.username)).toEqual(['chandra']);
  });
});

describe('posts and Home feed', () => {
  it('shows only followed people, newest first, with cursor pagination', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const stranger = await createUser(ctx.app, 'stranger');
    await ctx.app.inject({ method: 'PUT', url: `/users/${bina.id}/follow`, headers: ali.headers });

    for (const caption of ['one', 'two', 'three']) await textPost(bina, caption);
    await textPost(stranger, 'not followed');

    const page1 = (await ctx.app.inject({ method: 'GET', url: '/feed?limit=2', headers: ali.headers })).json();
    expect(page1.items.map((p: { caption: string }) => p.caption)).toEqual(['three', 'two']);
    expect(page1.next_cursor).toEqual(expect.any(String));

    const page2 = (
      await ctx.app.inject({ method: 'GET', url: `/feed?limit=2&cursor=${page1.next_cursor}`, headers: ali.headers })
    ).json();
    expect(page2.items.map((p: { caption: string }) => p.caption)).toEqual(['one']);
    expect(page2.next_cursor).toBeNull();
  });

  it('requires a caption on text posts, and only the author can delete a post', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    const empty = await ctx.app.inject({ method: 'POST', url: '/posts', headers: ali.headers, payload: { type: 'text' } });
    expect(empty.statusCode).toBe(400);

    const post = await textPost(ali, 'mine');
    expect((await ctx.app.inject({ method: 'DELETE', url: `/posts/${post.id}`, headers: bina.headers })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/posts/${post.id}`, headers: ali.headers })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/posts/${post.id}`, headers: ali.headers })).statusCode).toBe(404);
  });
});

describe('likes, comments and notifications', () => {
  it('counts likes and notifies the author, but not for liking your own post', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const post = await textPost(ali, 'Gradient descent in one picture');

    await ctx.app.inject({ method: 'PUT', url: `/posts/${post.id}/like`, headers: bina.headers });
    await ctx.app.inject({ method: 'PUT', url: `/posts/${post.id}/like`, headers: ali.headers });

    const seenByBina = (await ctx.app.inject({ method: 'GET', url: `/posts/${post.id}`, headers: bina.headers })).json();
    expect(seenByBina).toMatchObject({ like_count: 2, liked_by_me: true });
    expect(await notificationsOf(ali)).toMatchObject([{ type: 'like', post_id: post.id, actor: { username: 'bina' } }]);

    await ctx.app.inject({ method: 'DELETE', url: `/posts/${post.id}/like`, headers: bina.headers });
    const after = (await ctx.app.inject({ method: 'GET', url: `/posts/${post.id}`, headers: bina.headers })).json();
    expect(after).toMatchObject({ like_count: 1, liked_by_me: false });
  });

  it('threads replies and notifies the post author and the person replied to', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const chandra = await createUser(ctx.app, 'chandra');
    const post = await textPost(ali, 'What is attention?');
    const comment = (user: TestUser, body: string, parent_id?: number) =>
      ctx.app.inject({ method: 'POST', url: `/posts/${post.id}/comments`, headers: user.headers, payload: { body, parent_id } });

    const top = (await comment(bina, 'Great question')).json();
    const reply = await comment(chandra, 'Agreed', top.id);
    expect(reply.statusCode).toBe(201);

    expect((await notificationsOf(bina)).map((n: { type: string }) => n.type)).toEqual(['reply']);
    expect((await notificationsOf(ali)).map((n: { type: string }) => n.type)).toEqual(['comment', 'comment']);

    const list = (await ctx.app.inject({ method: 'GET', url: `/posts/${post.id}/comments`, headers: ali.headers })).json();
    expect(list.items).toMatchObject([{ id: top.id, reply_count: 1 }]);
    const replies = (await ctx.app.inject({ method: 'GET', url: `/comments/${top.id}/replies`, headers: ali.headers })).json();
    expect(replies.items).toMatchObject([{ body: 'Agreed', parent_id: top.id }]);

    const otherPost = await textPost(ali, 'Another post');
    const crossThread = await ctx.app.inject({
      method: 'POST',
      url: `/posts/${otherPost.id}/comments`,
      headers: bina.headers,
      payload: { body: 'wrong thread', parent_id: top.id },
    });
    expect(crossThread.json().error.code).toBe('INVALID_PARENT');
  });

  it('counts unread notifications and marks one read', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    await ctx.app.inject({ method: 'PUT', url: `/users/${ali.id}/follow`, headers: bina.headers });

    const unread = () => ctx.app.inject({ method: 'GET', url: '/notifications/unread-count', headers: ali.headers });
    expect((await unread()).json()).toEqual({ count: 1 });

    const [notification] = await notificationsOf(ali);
    expect((await ctx.app.inject({ method: 'POST', url: `/notifications/${notification.id}/read`, headers: bina.headers })).statusCode).toBe(404);
    await ctx.app.inject({ method: 'POST', url: `/notifications/${notification.id}/read`, headers: ali.headers });
    expect((await unread()).json()).toEqual({ count: 0 });
  });
});
