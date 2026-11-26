import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { call, createUser, useTestApp, type TestUser } from './helpers';

// Learn areas (migration 007) and Explore: one set of field chips filters topics, lessons,
// courses, questions, quizzes and the Explore grid.

const ctx = useTestApp();

async function ok(user: TestUser, method: string, url: string, payload?: object) {
  const result = await call(ctx.app, user, method, url, payload);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}
const publish = (admin: TestUser, path: string) => ok(admin, 'PUT', `${path}/status`, { status: 'published' });

/** Two areas, a topic in each, a lesson, a question, a quiz and a course per area. */
async function seedAreas(admin: TestUser) {
  await ok(admin, 'POST', '/v1/admin/fields', { name: 'Transformers' });
  await ok(admin, 'POST', '/v1/admin/fields', { name: 'Computer vision' });
  const topic = await ok(admin, 'POST', '/v1/admin/topics', { name: 'Attention mechanism', field: 'transformers' });
  expect(topic).toMatchObject({ slug: 'attention-mechanism', field: { slug: 'transformers', name: 'Transformers' } });
  expect(topic.id).toBeUndefined(); // no internal ids
  await ok(admin, 'POST', '/v1/admin/topics', { name: 'Convolutions', field: 'computer-vision' });
  await ok(admin, 'POST', '/v1/admin/topics', { name: 'Unfiled concept' });

  for (const topicSlug of ['attention-mechanism', 'convolutions']) {
    const item = await ok(admin, 'POST', '/v1/admin/learn-items', { topic: topicSlug, title: `Lesson on ${topicSlug}`, kind: 'text', body: 'Body' });
    await publish(admin, `/v1/admin/learn-items/${item.id}`);
    const question = await ok(admin, 'POST', '/v1/admin/questions', {
      topic: topicSlug,
      kind: 'short',
      prompt: `Question on ${topicSlug}?`,
      answer: 'yes',
    });
    await publish(admin, `/v1/admin/questions/${question.id}`);
    const quiz = await ok(admin, 'POST', '/v1/admin/quizzes', { title: `Quiz on ${topicSlug}`, topic: topicSlug });
    await ok(admin, 'PUT', `/v1/admin/quizzes/${quiz.id}/questions`, { question_ids: [question.id] });
    await publish(admin, `/v1/admin/quizzes/${quiz.id}`);
  }
  const course = await ok(admin, 'POST', '/v1/admin/courses', { title: 'Vision course', external_url: 'https://cs231n.stanford.edu/', field: 'computer-vision' });
  expect(course.field).toEqual({ slug: 'computer-vision', name: 'Computer vision' });
  await publish(admin, `/v1/admin/courses/${course.id}`);
  const other = await ok(admin, 'POST', '/v1/admin/courses', { title: 'Unfiled course', external_url: 'https://example.com/' });
  await publish(admin, `/v1/admin/courses/${other.id}`);
  return { course };
}

describe('learn areas', () => {
  it('filters topics, lessons, questions, quizzes and courses by area', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'ali');
    await seedAreas(admin);

    const all = await ok(user, 'GET', '/v1/topics');
    expect(all.items).toHaveLength(3);
    expect(all.items.find((t: { slug: string }) => t.slug === 'unfiled-concept').field).toBeNull();

    const vision = await ok(user, 'GET', '/v1/topics?field=computer-vision');
    expect(vision.items.map((t: { slug: string }) => t.slug)).toEqual(['convolutions']);
    expect((await ok(user, 'GET', '/v1/topics/attention-mechanism')).field).toEqual({ slug: 'transformers', name: 'Transformers' });

    const lessons = await ok(user, 'GET', '/v1/learn-items?field=transformers');
    expect(lessons.items.map((i: { title: string }) => i.title)).toEqual(['Lesson on attention-mechanism']);

    const questions = await ok(user, 'GET', '/v1/practice/questions?field=computer-vision');
    expect(questions.items.map((q: { prompt: string }) => q.prompt)).toEqual(['Question on convolutions?']);

    const quizzes = await ok(user, 'GET', '/v1/quizzes?field=transformers');
    expect(quizzes.items.map((q: { title: string }) => q.title)).toEqual(['Quiz on attention-mechanism']);

    const courses = await ok(user, 'GET', '/v1/courses?field=computer-vision');
    expect(courses.items).toMatchObject([{ title: 'Vision course', field: { slug: 'computer-vision' } }]);
    expect((await ok(user, 'GET', '/v1/courses')).items).toHaveLength(2);

    // An unknown area matches nothing rather than everything.
    expect((await ok(user, 'GET', '/v1/learn-items?field=nope')).items).toHaveLength(0);
  });

  it('lets staff move a topic or course to another area, or unfile it, and audits it', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const { course } = await seedAreas(admin);

    expect(await ok(admin, 'PATCH', '/v1/admin/topics/convolutions', { field: 'transformers' })).toMatchObject({ field: { slug: 'transformers' } });
    expect(await ok(admin, 'PATCH', '/v1/admin/topics/convolutions', { field: null })).toMatchObject({ field: null });
    expect(await ok(admin, 'PATCH', '/v1/admin/topics/convolutions', { summary: 'Sliding filters.' })).toMatchObject({ field: null, summary: 'Sliding filters.' });
    expect(await ok(admin, 'PATCH', `/v1/admin/courses/${course.id}`, { field: null })).toMatchObject({ field: null });

    const unknown = await call(ctx.app, admin, 'PATCH', '/v1/admin/topics/convolutions', { field: 'nope' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_REFERENCE');

    const log = (await ok(admin, 'GET', '/v1/admin/audit-log')).items.map((entry: { action: string }) => entry.action);
    expect(log).toEqual(expect.arrayContaining(['topic.update', 'course.update']));
  });
});

describe('explore', () => {
  async function textPost(user: TestUser, caption: string, topic?: string) {
    return ok(user, 'POST', '/v1/posts', { type: 'text', caption, topic });
  }

  it('shows public posts by others, newest first, filtered by area through the post topic', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    await seedAreas(admin);
    const viewer = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    await textPost(viewer, 'my own post');
    const attention = await textPost(bina, 'attention post', 'attention-mechanism');
    const vision = await textPost(bina, 'vision post', 'convolutions');
    const untagged = await textPost(bina, 'untagged post');

    const all = await ok(viewer, 'GET', '/v1/explore');
    expect(all.items.map((p: { id: string }) => p.id)).toEqual([untagged.id, vision.id, attention.id]);
    expect(all.items[0]).toMatchObject({ author: { username: 'bina' }, liked_by_me: false });

    const transformers = await ok(viewer, 'GET', '/v1/explore?field=transformers');
    expect(transformers.items.map((p: { id: string }) => p.id)).toEqual([attention.id]);
  });

  it('leaves out private, blocked and deleted posts', async () => {
    const viewer = await createUser(ctx.app, 'ali');
    const priv = await createUser(ctx.app, 'priv');
    const blocker = await createUser(ctx.app, 'blocker');
    const open = await createUser(ctx.app, 'open');

    await ok(priv, 'PATCH', '/v1/me', { is_private: true });
    await textPost(priv, 'private account post');
    await textPost(blocker, 'blocked post');
    await ok(blocker, 'PUT', `/v1/users/${viewer.id}/block`);
    const deleted = await textPost(open, 'deleted post');
    await ok(open, 'DELETE', `/v1/posts/${deleted.id}`);
    const kept = await textPost(open, 'kept post');

    // A private account's posts stay out even for an accepted follower.
    await ok(viewer, 'PUT', `/v1/users/${priv.id}/follow`);
    await ok(priv, 'POST', `/v1/me/follow-requests/${viewer.id}/accept`);

    const page = await ok(viewer, 'GET', '/v1/explore');
    expect(page.items.map((p: { id: string }) => p.id)).toEqual([kept.id]);
    expect(await db.selectFrom('posts').select('id').execute()).toHaveLength(4);
  });
});
