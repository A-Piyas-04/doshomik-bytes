import { describe, expect, it } from 'vitest';
import { createUser, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();

async function post(user: TestUser, url: string, payload: object, status = 201) {
  const response = await ctx.app.inject({ method: 'POST', url, headers: user.headers, payload });
  expect(response.statusCode, response.body).toBe(status);
  return response.json();
}

async function put(user: TestUser, url: string, payload: object) {
  const response = await ctx.app.inject({ method: 'PUT', url, headers: user.headers, payload });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}

async function get(user: TestUser, url: string) {
  const response = await ctx.app.inject({ method: 'GET', url, headers: user.headers });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe('admin content', () => {
  it('is only open to admins', async () => {
    const user = await createUser(ctx.app, 'ali');
    const response = await ctx.app.inject({ method: 'POST', url: '/admin/topics', headers: user.headers, payload: { name: 'X' } });
    expect(response.statusCode).toBe(403);
  });

  it('validates MCQs: two or more options, and the answer is one of them', async () => {
    const admin = await createUser(ctx.app, 'admin', { admin: true });
    const topic = await post(admin, '/admin/topics', { name: 'Gradient descent' });

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: admin.headers,
      payload: { topic_id: topic.id, kind: 'mcq', prompt: 'Pick one', options: ['A', 'B'], answer: 'C' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('Learn and Practice', () => {
  it('orders course items and keeps one learn item reusable across courses', async () => {
    const admin = await createUser(ctx.app, 'admin', { admin: true });
    const topic = await post(admin, '/admin/topics', { name: 'Transformers' });
    const a = await post(admin, '/admin/learn-items', { topic_id: topic.id, title: 'Tokens', kind: 'text', body: '...' });
    const b = await post(admin, '/admin/learn-items', { topic_id: topic.id, title: 'Attention', kind: 'text', body: '...' });
    const course1 = await post(admin, '/admin/courses', { title: 'LLM basics' });
    const course2 = await post(admin, '/admin/courses', { title: 'NLP' });

    await put(admin, `/admin/courses/${course1.id}/items`, { item_ids: [b.id, a.id] });
    await put(admin, `/admin/courses/${course2.id}/items`, { item_ids: [b.id] });

    const course = await get(admin, `/courses/${course1.id}`);
    expect(course.items.map((i: { title: string; position: number }) => [i.position, i.title])).toEqual([
      [1, 'Attention'],
      [2, 'Tokens'],
    ]);
    const courses = await get(admin, '/courses');
    expect(courses.items.map((c: { item_count: number }) => c.item_count).sort()).toEqual([1, 2]);

    const external = await post(admin, '/admin/courses', { title: 'Free course', external_url: 'https://example.com/course' });
    const rejected = await ctx.app.inject({
      method: 'PUT',
      url: `/admin/courses/${external.id}/items`,
      headers: admin.headers,
      payload: { item_ids: [a.id] },
    });
    expect(rejected.json().error.code).toBe('EXTERNAL_COURSE');
  });

  it('hides answers until submitted, then checks them ignoring case and spacing', async () => {
    const admin = await createUser(ctx.app, 'admin', { admin: true });
    const user = await createUser(ctx.app, 'ali');
    const topic = await post(admin, '/admin/topics', { name: 'Neural networks' });
    const question = await post(admin, '/admin/questions', {
      topic_id: topic.id,
      kind: 'short',
      prompt: 'What algorithm computes gradients in a neural network?',
      answer: 'Backpropagation',
      explanation: 'It applies the chain rule layer by layer.',
    });

    const listed = await get(user, `/practice/questions?topic_id=${topic.id}`);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).not.toHaveProperty('answer');

    const result = await post(user, `/practice/questions/${question.id}/answer`, { answer: '  backPROPagation ' }, 200);
    expect(result).toEqual({
      correct: true,
      correct_answer: 'Backpropagation',
      explanation: 'It applies the chain rule layer by layer.',
    });
  });
});

describe('Research', () => {
  it('builds Learn first, the tracker, the roadmap and the discussion', async () => {
    const admin = await createUser(ctx.app, 'admin', { admin: true });
    const user = await createUser(ctx.app, 'ali');

    const field = await post(admin, '/admin/fields', { name: 'Large Language Models' });
    const attention = await post(admin, '/admin/topics', { name: 'Attention', summary: 'Weighting inputs by relevance.' });
    const softmax = await post(admin, '/admin/topics', { name: 'Softmax', summary: 'Turns scores into probabilities.' });
    await post(admin, '/admin/learn-items', {
      topic_id: attention.id,
      title: 'Attention explained',
      kind: 'video',
      media_url: 'https://cdn.example.com/attention.mp4',
      duration_seconds: 60,
    });
    const paper = await post(admin, '/admin/papers', {
      field_id: field.id,
      title: 'Attention Is All You Need',
      authors: 'Vaswani et al.',
      year: 2017,
      paper_url: 'https://arxiv.org/abs/1706.03762',
      research_questions: ['Can attention alone replace recurrence?'],
      method_steps: ['Encode', 'Attend', 'Decode'],
      figures: [{ url: 'https://cdn.example.com/fig1.png', caption: 'The Transformer' }],
    });
    expect(paper.figures).toEqual([{ url: 'https://cdn.example.com/fig1.png', caption: 'The Transformer' }]);
    await put(admin, `/admin/papers/${paper.id}/prerequisites`, { topic_ids: [softmax.id, attention.id] });
    await put(admin, `/admin/fields/${field.id}/roadmap`, { steps: [{ paper_id: paper.id, note: 'Start here' }] });

    // Learn first: both topics in order; only Attention has a video.
    const learnFirst = await get(user, `/papers/${paper.id}/learn-first`);
    expect(learnFirst).toMatchObject({
      topic_count: 2,
      topics_with_learn_items: 1,
      topics: [
        { name: 'Softmax', summary: 'Turns scores into probabilities.', learn_items: [] },
        { name: 'Attention', learn_items: [{ title: 'Attention explained', kind: 'video' }] },
      ],
    });

    // Tracker: saved -> reading.
    await put(user, `/papers/${paper.id}/status`, { status: 'saved' });
    await put(user, `/papers/${paper.id}/status`, { status: 'reading' });
    expect((await get(user, `/papers/${paper.id}`)).my_status).toBe('reading');
    const tracker = await get(user, `/users/${user.id}/papers`);
    expect(tracker.saved).toHaveLength(0);
    expect(tracker.reading).toMatchObject([{ title: 'Attention Is All You Need' }]);

    // List filter and search.
    expect((await get(user, `/papers?field_id=${field.id}`)).items).toHaveLength(1);
    expect((await get(user, '/papers?q=attention')).items).toHaveLength(1);
    expect((await get(user, '/papers?q=convolution')).items).toHaveLength(0);

    // Roadmap.
    const roadmap = await get(user, `/fields/${field.id}/roadmap`);
    expect(roadmap.steps).toMatchObject([{ position: 1, note: 'Start here', paper: { id: paper.id } }]);

    // Discussion uses the comments table with paper_id set.
    const comment = await post(user, `/papers/${paper.id}/comments`, { body: 'Can someone explain multi-head attention?' });
    expect(comment).toMatchObject({ paper_id: paper.id, post_id: null });
  });
});

describe('search', () => {
  it('groups matches by type and tolerates typos in usernames and topic names', async () => {
    const admin = await createUser(ctx.app, 'admin', { admin: true });
    const user = await createUser(ctx.app, 'rahimuddin');
    await post(admin, '/admin/topics', { name: 'Backpropagation' });
    await post(user, '/posts', { type: 'text', caption: 'My notes on transformers' });

    const typo = await get(user, '/search?q=rahimudin');
    expect(typo.users).toMatchObject([{ username: 'rahimuddin' }]);
    expect(Object.keys(typo).sort()).toEqual(['courses', 'learn_items', 'papers', 'posts', 'topics', 'users']);

    expect((await get(user, '/search?q=backpropogation')).topics).toMatchObject([{ name: 'Backpropagation' }]);
    expect((await get(user, '/search?q=transformer&type=posts')).posts).toHaveLength(1);
  });
});
