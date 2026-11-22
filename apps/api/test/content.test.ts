import { describe, expect, it } from 'vitest';
import { call, createUser, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();

async function ok(user: TestUser, method: string, url: string, payload?: object) {
  const result = await call(ctx.app, user, method, url, payload);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}
const publish = (admin: TestUser, path: string) => ok(admin, 'PUT', `${path}/status`, { status: 'published' });

/** A field, two topics (one with a video), and a published paper with both as Learn first. */
async function seedResearch(admin: TestUser) {
  await ok(admin, 'POST', '/v1/admin/fields', { name: 'Large Language Models' });
  await ok(admin, 'POST', '/v1/admin/topics', { name: 'Attention mechanism', summary: 'Weighting inputs by relevance.' });
  await ok(admin, 'POST', '/v1/admin/topics', { name: 'Softmax', summary: 'Scores to probabilities.' });
  const item = await ok(admin, 'POST', '/v1/admin/learn-items', {
    topic: 'attention-mechanism',
    title: 'Attention explained',
    kind: 'video',
    media_url: 'https://cdn.example.com/attention.mp4',
  });
  await publish(admin, `/v1/admin/learn-items/${item.id}`);
  const paper = await ok(admin, 'POST', '/v1/admin/papers', {
    field: 'large-language-models',
    title: 'Attention Is All You Need',
    paper_url: 'https://arxiv.org/abs/1706.03762',
    main_idea: 'Self-attention replaces recurrence.',
    figures: [{ url: 'https://cdn.example.com/fig1.png', caption: 'The Transformer' }],
  });
  await ok(admin, 'PUT', `/v1/admin/papers/${paper.id}/prerequisites`, { topics: ['softmax', 'attention-mechanism'] });
  return { paper, item };
}

describe('publishing workflow', () => {
  it('keeps drafts out of every user-facing list until an admin publishes them, and audits it', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'ali');
    const { paper } = await seedResearch(admin);
    expect(paper.status).toBe('draft');

    expect((await call(ctx.app, user, 'GET', `/v1/papers/${paper.id}`)).status).toBe(404);
    expect((await ok(user, 'GET', '/v1/papers')).items).toHaveLength(0);
    expect((await ok(user, 'GET', '/v1/search?q=attention')).papers).toHaveLength(0);
    expect((await ok(admin, 'GET', `/v1/admin/papers/${paper.id}`)).prerequisites).toHaveLength(2); // preview

    await publish(admin, `/v1/admin/papers/${paper.id}`);
    const live = await ok(user, 'GET', `/v1/papers/${paper.id}`);
    expect(live).toMatchObject({ title: 'Attention Is All You Need', field: { slug: 'large-language-models' }, my_status: null });
    expect(live.published_at).toEqual(expect.any(String));
    expect(live.share_url).toBe(`http://localhost:3000/papers/${paper.id}`);
    expect((await ok(user, 'GET', '/v1/search?q=attention')).papers).toHaveLength(1);

    const log = (await ok(admin, 'GET', '/v1/admin/audit-log')).items.map((entry: { action: string }) => entry.action);
    expect(log).toEqual(expect.arrayContaining(['paper.create', 'paper.prerequisites', 'paper.publish', 'learn_item.publish']));

    await ok(admin, 'PUT', `/v1/admin/papers/${paper.id}/status`, { status: 'archived' });
    expect((await call(ctx.app, user, 'GET', `/v1/papers/${paper.id}`)).status).toBe(404);
  });
});

describe('Research', () => {
  it('builds Learn first from published items, tracks reading, and finds related papers', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'ali');
    const { paper } = await seedResearch(admin);
    await publish(admin, `/v1/admin/papers/${paper.id}`);
    const bert = await ok(admin, 'POST', '/v1/admin/papers', { field: 'large-language-models', title: 'BERT', paper_url: 'https://arxiv.org/abs/1810.04805' });
    await ok(admin, 'PUT', `/v1/admin/papers/${bert.id}/prerequisites`, { topics: ['attention-mechanism'] });
    await publish(admin, `/v1/admin/papers/${bert.id}`);

    expect(await ok(user, 'GET', `/v1/papers/${paper.id}/learn-first`)).toMatchObject({
      topic_count: 2,
      topics_with_learn_items: 1,
      topics: [
        { slug: 'softmax', learn_items: [] },
        { slug: 'attention-mechanism', learn_items: [{ title: 'Attention explained', kind: 'video' }] },
      ],
    });
    expect((await ok(user, 'GET', `/v1/papers/${paper.id}/related`)).items).toMatchObject([{ id: bert.id, shared_topics: 1 }]);

    await ok(user, 'PUT', `/v1/papers/${paper.id}/status`, { status: 'reading' });
    expect((await ok(user, 'GET', `/v1/users/${user.id}/papers`)).reading).toMatchObject([{ id: paper.id }]);

    await ok(admin, 'PUT', '/v1/admin/fields/large-language-models/roadmap', {
      steps: [{ paper_id: bert.id, note: 'Start here' }, { paper_id: paper.id }],
    });
    const roadmap = await ok(user, 'GET', '/v1/fields/large-language-models/roadmap');
    expect(roadmap.steps.map((s: { step: number; paper: { title: string } }) => [s.step, s.paper.title])).toEqual([
      [1, 'BERT'],
      [2, 'Attention Is All You Need'],
    ]);

    // Onboarding interests filter the paper list.
    expect((await ok(user, 'GET', '/v1/papers?interests=true')).items).toHaveLength(0);
    await ok(user, 'PUT', '/v1/me/interests', { fields: ['large-language-models'] });
    expect((await ok(user, 'GET', '/v1/papers?interests=true')).items).toHaveLength(2);
  });
});

describe('Learn', () => {
  it('lists only published course steps and remembers progress', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'ali');
    const items = [];
    for (const title of ['Tokens', 'Attention', 'Draft lesson']) {
      items.push(await ok(admin, 'POST', '/v1/admin/learn-items', { title, kind: 'text', body: '...' }));
    }
    await publish(admin, `/v1/admin/learn-items/${items[0].id}`);
    await publish(admin, `/v1/admin/learn-items/${items[1].id}`);
    const course = await ok(admin, 'POST', '/v1/admin/courses', { title: 'LLM basics' });
    await ok(admin, 'PUT', `/v1/admin/courses/${course.id}/items`, { item_ids: [items[1].id, items[2].id, items[0].id] });
    await publish(admin, `/v1/admin/courses/${course.id}`);

    const live = await ok(user, 'GET', `/v1/courses/${course.id}`);
    expect(live.item_count).toBe(2);
    expect(live.items.map((i: { step: number; title: string }) => [i.step, i.title])).toEqual([
      [1, 'Attention'],
      [2, 'Tokens'],
    ]);

    await ok(user, 'PUT', `/v1/courses/${course.id}/progress`, { last_position: 1 });
    expect((await ok(user, 'GET', '/v1/me/courses')).items).toMatchObject([{ id: course.id, my_progress: { last_position: 1, completed_at: null } }]);
    const done = await ok(user, 'PUT', `/v1/courses/${course.id}/progress`, { last_position: 2 });
    expect(done.completed_at).toEqual(expect.any(String));
    expect((await call(ctx.app, user, 'PUT', `/v1/courses/${course.id}/progress`, { last_position: 3 })).status).toBe(400);
  });
});

describe('Practice', () => {
  it('records answers, reports accuracy and streak, and serves quizzes in order', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'ali');
    await ok(admin, 'POST', '/v1/admin/topics', { name: 'Neural networks' });
    const bad = await call(ctx.app, admin, 'POST', '/v1/admin/questions', { topic: 'neural-networks', kind: 'mcq', prompt: 'Pick', options: ['A', 'B'], answer: 'C' });
    expect(bad.status).toBe(400);

    const q1 = await ok(admin, 'POST', '/v1/admin/questions', { topic: 'neural-networks', kind: 'short', prompt: 'Which rule does backprop use?', answer: 'Chain rule' });
    const q2 = await ok(admin, 'POST', '/v1/admin/questions', { topic: 'neural-networks', kind: 'mcq', prompt: 'Gradient direction?', options: ['Along', 'Against'], answer: 'Against' });
    expect((await ok(user, 'GET', '/v1/practice/questions?topic=neural-networks')).items).toHaveLength(0); // drafts
    await publish(admin, `/v1/admin/questions/${q1.id}`);
    await publish(admin, `/v1/admin/questions/${q2.id}`);

    const listed = (await ok(user, 'GET', '/v1/practice/questions?topic=neural-networks')).items;
    expect(listed).toHaveLength(2);
    expect(listed[0]).not.toHaveProperty('answer');

    expect((await ok(user, 'POST', `/v1/practice/questions/${q1.id}/answer`, { answer: ' CHAIN  rule ' })).correct).toBe(true);
    expect((await ok(user, 'POST', `/v1/practice/questions/${q2.id}/answer`, { answer: 'Along' })).correct).toBe(false);
    expect(await ok(user, 'GET', '/v1/me/practice/stats')).toMatchObject({
      attempts: 2,
      correct: 1,
      accuracy: 0.5,
      streak_days: 1,
      topics: [{ slug: 'neural-networks', attempts: 2, correct: 1 }],
    });
    expect((await ok(user, 'GET', '/v1/me/practice/history')).items).toHaveLength(2);

    const quiz = await ok(admin, 'POST', '/v1/admin/quizzes', { title: 'Backprop basics', topic: 'neural-networks' });
    await ok(admin, 'PUT', `/v1/admin/quizzes/${quiz.id}/questions`, { question_ids: [q2.id, q1.id] });
    await publish(admin, `/v1/admin/quizzes/${quiz.id}`);
    const live = await ok(user, 'GET', `/v1/quizzes/${quiz.id}`);
    expect(live).toMatchObject({ title: 'Backprop basics', question_count: 2 });
    expect(live.questions.map((q: { id: string }) => q.id)).toEqual([q2.id, q1.id]);
  });
});

describe('search', () => {
  it('tolerates typos, leaves out private posts, and suggests while typing', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    const user = await createUser(ctx.app, 'rahman_ml');
    const secretive = await createUser(ctx.app, 'secretive');
    await ok(admin, 'POST', '/v1/admin/topics', { name: 'Backpropagation' });
    await ok(user, 'POST', '/v1/posts', { type: 'text', caption: 'My transformer notes' });
    await ok(secretive, 'PATCH', '/v1/me', { is_private: true });
    await ok(secretive, 'POST', '/v1/posts', { type: 'text', caption: 'Private transformer notes' });

    expect((await ok(admin, 'GET', '/v1/search?q=rahmn_ml')).users).toMatchObject([{ username: 'rahman_ml' }]);
    expect((await ok(admin, 'GET', '/v1/search?q=backpropogation')).topics).toMatchObject([{ slug: 'backpropagation' }]);
    expect((await ok(admin, 'GET', '/v1/search?q=transformer&type=posts')).posts).toMatchObject([{ caption: 'My transformer notes' }]);

    const suggestions = (await ok(admin, 'GET', '/v1/search/suggest?q=ra')).items;
    expect(suggestions).toContainEqual({ type: 'user', id: user.id, label: 'rahman_ml' });
    expect((await call(ctx.app, admin, 'GET', '/v1/search/suggest?q=r')).status).toBe(400);
  });
});
