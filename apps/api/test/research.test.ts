import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { providers } from '../src/providers';
import type { OpenAlexWork, S2Paper, S2Reference, ScholarlySources } from '../src/providers/scholarly';
import { rankPapers, syncDuePapers, syncTrending } from '../src/worker/papers';
import { call, createUser, useTestApp, type TestUser } from './helpers';

const ctx = useTestApp();
const silent = pino({ level: 'silent' });

async function ok(user: TestUser, method: string, url: string, payload?: object) {
  const result = await call(ctx.app, user, method, url, payload);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}

// ---------- Fake scholarly sources (tests never reach the network) ----------

const works: Record<string, Partial<OpenAlexWork>> = {
  '1706.03762': { openalexId: 'W1', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, venue: 'NeurIPS', publishedOn: '2017-06-12' },
  '1810.04805': { openalexId: 'W2', title: 'BERT: Pre-training of Deep Bidirectional Transformers', authors: ['Jacob Devlin'], year: 2018, referencedWorks: ['W1'] },
};
const s2: Record<string, S2Paper> = {
  '1706.03762': { s2Id: 's2-attention', doi: null, arxivId: '1706.03762', citationCount: 150000, tldr: 'Attention alone is enough.', pdfUrl: 'https://arxiv.org/pdf/1706.03762', venue: null },
  '1810.04805': { s2Id: 's2-bert', doi: null, arxivId: '1810.04805', citationCount: 90000, tldr: null, pdfUrl: null, venue: null },
};
const references: Record<string, S2Reference[]> = {
  's2-bert': [{ s2Id: 's2-attention', doi: null, arxivId: '1706.03762', intents: ['methodology'], isInfluential: true }],
};

const fakeSources: ScholarlySources = {
  openAlex: {
    work: async (ref) => {
      const w = ref.arxivId ? works[ref.arxivId] : undefined;
      return w
        ? { doi: null, authors: [], year: null, publishedOn: null, venue: null, abstract: 'An abstract.', citationCount: 1, topics: [], referencedWorks: [], title: null, openalexId: 'W0', ...w }
        : null;
    },
  },
  semanticScholar: {
    paper: async (ref) => (ref.arxivId ? (s2[ref.arxivId] ?? null) : null),
    references: async (s2Id) => references[s2Id] ?? [],
  },
  huggingFace: {
    dailyPapers: async (date) =>
      date === new Date().toISOString().slice(0, 10)
        ? [{ arxivId: '1810.04805', upvotes: 42, githubRepo: 'https://github.com/google-research/bert', listedAt: new Date().toISOString() }]
        : [],
  },
};

beforeEach(() => {
  providers.scholarly = fakeSources;
});

/** An admin, a field and two imported, synced and published papers. */
async function seedCollection() {
  const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
  await ok(admin, 'POST', '/v1/admin/fields', { name: 'Transformers', position: 4 });
  const attention = await ok(admin, 'POST', '/v1/admin/papers/import', { field: 'transformers', arxiv_id: '1706.03762' });
  const bert = await ok(admin, 'POST', '/v1/admin/papers/import', { field: 'transformers', arxiv_id: '1810.04805' });
  expect(attention.title).toBe('');

  expect(await syncDuePapers(silent)).toBe(2);
  await syncTrending(silent);
  for (const paper of [attention, bert]) await ok(admin, 'PUT', `/v1/admin/papers/${paper.id}/status`, { status: 'published' });
  await rankPapers();
  return { admin, attention, bert };
}

describe('A1 collection and ingestion', () => {
  it('fills metadata from the sources and lists papers by trend rank', async () => {
    const { attention, bert } = await seedCollection();
    const user = await createUser(ctx.app, 'ali');

    const list = (await ok(user, 'GET', '/v1/papers?field=transformers')).items;
    // BERT is trending on Hugging Face, so it comes first despite fewer citations.
    expect(list.map((p: { id: string }) => p.id)).toEqual([bert.id, attention.id]);
    expect(list[0]).toMatchObject({ trend_rank: 1, is_trending: true, hf_upvotes: 42, citation_count: 90000, saved_by_me: false, my_step: 0 });
    expect(list[1]).toMatchObject({ title: 'Attention Is All You Need', venue: 'NeurIPS', citation_count: 150000, is_trending: false, is_new: false });

    const paper = await ok(user, 'GET', `/v1/papers/${attention.id}`);
    expect(paper).toMatchObject({
      authors: 'Ashish Vaswani, Noam Shazeer',
      arxiv_id: '1706.03762',
      tldr: 'Attention alone is enough.',
      published_on: '2017-06-12',
      links: { open_url: 'https://arxiv.org/abs/1706.03762', pdf_url: 'https://arxiv.org/pdf/1706.03762' },
    });
    expect((await ok(user, 'GET', `/v1/papers/${bert.id}`)).links.code_url).toBe('https://github.com/google-research/bert');

    const page1 = await ok(user, 'GET', '/v1/papers?limit=1');
    const page2 = await ok(user, 'GET', `/v1/papers?limit=1&cursor=${page1.next_cursor}`);
    expect(page2.items[0].id).toBe(attention.id);
    expect((await ok(user, 'GET', '/v1/papers?sort=newest')).items[0].id).toBe(bert.id);
  });

  it('keeps the chip order', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    await ok(admin, 'POST', '/v1/admin/fields', { name: 'Agents', position: 7 });
    await ok(admin, 'POST', '/v1/admin/fields', { name: 'ML fundamentals', position: 1 });
    const user = await createUser(ctx.app, 'ali');
    expect((await ok(user, 'GET', '/v1/fields')).items.map((f: { slug: string }) => f.slug)).toEqual(['ml-fundamentals', 'agents']);
  });
});

describe('A2 search', () => {
  it('matches authors, and a Bangla query through the Bangla card', async () => {
    const { admin, attention } = await seedCollection();
    await ok(admin, 'PUT', `/v1/admin/papers/${attention.id}/cards/bn`, { question: 'মনোযোগ দিয়েই কি অনুবাদ সম্ভব?' });
    const user = await createUser(ctx.app, 'ali');

    expect((await ok(user, 'GET', '/v1/papers?q=Vaswani')).items.map((p: { id: string }) => p.id)).toEqual([attention.id]);
    const bangla = (await ok(user, 'GET', `/v1/papers?q=${encodeURIComponent('অনুবাদ')}`)).items;
    expect(bangla.map((p: { id: string }) => p.id)).toEqual([attention.id]);
    expect(bangla[0].question.bn).toBe('মনোযোগ দিয়েই কি অনুবাদ সম্ভব?');
    expect((await ok(user, 'GET', '/v1/search?q=Vaswani')).papers).toHaveLength(1);
  });
});

describe('A3–A5 saves, reading passes and My papers', () => {
  it('runs Up next, the three steps, the private note and the counts', async () => {
    const { attention, bert } = await seedCollection();
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    expect((await ok(ali, 'GET', '/v1/me/papers/up-next')).paper).toBeNull();
    await ok(ali, 'PUT', `/v1/papers/${attention.id}/save`);
    await ok(ali, 'PUT', `/v1/papers/${bert.id}/save`);
    expect((await ok(ali, 'GET', '/v1/me/papers/up-next')).paper.id).toBe(attention.id);

    expect(await ok(ali, 'POST', `/v1/papers/${attention.id}/mark-read`)).toMatchObject({ step: 1 });
    expect((await ok(ali, 'GET', '/v1/me/papers/up-next')).paper.id).toBe(bert.id);
    expect((await ok(ali, 'GET', '/v1/me/papers?list=saved')).items.map((p: { id: string }) => p.id)).toEqual([bert.id]);
    expect((await ok(ali, 'GET', '/v1/me/papers?list=read')).items.map((p: { id: string }) => p.id)).toEqual([attention.id]);

    const reproduced = await ok(ali, 'PUT', `/v1/papers/${bert.id}/reading`, { step: 3 });
    expect(reproduced.reproduced_at).toEqual(expect.any(String));
    expect(await ok(ali, 'POST', `/v1/papers/${bert.id}/mark-read`)).toMatchObject({ step: 3 }); // never lowers
    const lowered = await ok(ali, 'PUT', `/v1/papers/${bert.id}/reading`, { step: 1 });
    expect(lowered).toMatchObject({ step: 1, studied_at: null, reproduced_at: null });

    expect((await call(ctx.app, ali, 'PUT', `/v1/papers/${bert.id}/note`, { note: 'x'.repeat(401) })).status).toBe(400);
    expect(await ok(ali, 'PUT', `/v1/papers/${bert.id}/note`, { note: 'Rank 8 on q, v is enough.' })).toMatchObject({ note: 'Rank 8 on q, v is enough.', step: 1 });
    expect((await ok(ali, 'GET', `/v1/papers/${bert.id}`)).my_reading).toMatchObject({ step: 1, note: 'Rank 8 on q, v is enough.' });
    expect((await ok(bina, 'GET', `/v1/papers/${bert.id}`)).my_reading).toBeNull(); // the note is private

    const stats = await ok(ali, 'GET', '/v1/me/reading/stats');
    expect(stats).toEqual({ this_month: { explored: 2, studied: 0, reproduced: 0 }, total: { explored: 2, studied: 0, reproduced: 0 } });
    expect(await ok(bina, 'GET', `/v1/users/${ali.id}/reading`)).toMatchObject({ visible: true, total: { explored: 2 } });
    await ok(ali, 'PATCH', '/v1/me', { is_private: true });
    expect(await ok(bina, 'GET', `/v1/users/${ali.id}/reading`)).toMatchObject({ visible: false });
  });

  it('reopens saved AI outputs from the stored row, for their owner only', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    const userId = (await db.selectFrom('users').select('id').where('public_id', '=', ali.id).executeTakeFirstOrThrow()).id;
    const output = await db
      .insertInto('research_outputs')
      .values({ user_id: userId, kind: 'reading_map', title: 'Small language models', params: '{"topic":"slm"}', result: '{"papers":[]}' })
      .returning('public_id')
      .executeTakeFirstOrThrow();

    expect((await ok(ali, 'GET', '/v1/me/research-outputs')).items).toMatchObject([{ id: output.public_id, kind: 'reading_map' }]);
    expect(await ok(ali, 'GET', `/v1/research-outputs/${output.public_id}`)).toMatchObject({ result: { papers: [] } });
    expect((await call(ctx.app, bina, 'GET', `/v1/research-outputs/${output.public_id}`)).status).toBe(404);
    await ok(ali, 'DELETE', `/v1/research-outputs/${output.public_id}`);
    expect((await ok(ali, 'GET', '/v1/me/research-outputs')).items).toHaveLength(0);
  });
});

describe('A6 lineage', () => {
  it('shows what a paper builds on and what built on it, and keeps staff intents', async () => {
    const { admin, attention, bert } = await seedCollection();
    const user = await createUser(ctx.app, 'ali');

    expect((await ok(user, 'GET', `/v1/papers/${bert.id}/lineage`)).builds_on).toMatchObject([{ id: attention.id, intent: 'supporting', is_influential: true }]);
    expect((await ok(user, 'GET', `/v1/papers/${attention.id}/lineage`)).built_on_by).toMatchObject([{ id: bert.id }]);

    await ok(admin, 'PUT', '/v1/admin/paper-edges', { citing_paper_id: bert.id, cited_paper_id: attention.id, intent: 'contrasting' });
    await ok(admin, 'POST', `/v1/admin/papers/${bert.id}/sync`);
    await syncDuePapers(silent);
    expect((await ok(user, 'GET', `/v1/papers/${bert.id}/lineage`)).builds_on[0].intent).toBe('contrasting');
  });
});

describe('A7 trails', () => {
  it('lets a user publish a reading path that others see and can report', async () => {
    const { attention, bert } = await seedCollection();
    const moderator = await createUser(ctx.app, 'mod', { role: 'moderator' });
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');

    const tooShort = await call(ctx.app, ali, 'POST', '/v1/trails', { title: 'Transformers', items: [{ paper_id: attention.id }], publish: true });
    expect(tooShort.status).toBe(400);

    const trail = await ok(ali, 'POST', '/v1/trails', { title: 'Attention to BERT', field: 'transformers' });
    expect(trail).toMatchObject({ status: 'draft', steps: [] });
    expect((await call(ctx.app, bina, 'GET', `/v1/trails/${trail.id}`)).status).toBe(404);

    await ok(ali, 'PUT', `/v1/trails/${trail.id}/items`, {
      items: [
        { paper_id: attention.id, note: 'Start here: the architecture.' },
        { paper_id: bert.id, note: 'Then pretraining.' },
      ],
    });
    await ok(ali, 'PUT', `/v1/trails/${trail.id}/status`, { status: 'published' });

    const seen = await ok(bina, 'GET', `/v1/trails/${trail.id}`);
    expect(seen).toMatchObject({ title: 'Attention to BERT', paper_count: 2, creator: { id: ali.id } });
    expect(seen.steps.map((s: { step: number; paper: { id: string } }) => [s.step, s.paper.id])).toEqual([
      [1, attention.id],
      [2, bert.id],
    ]);
    expect((await ok(bina, 'GET', '/v1/trails?field=transformers')).items).toHaveLength(1);
    expect((await call(ctx.app, bina, 'PATCH', `/v1/trails/${trail.id}`, { title: 'Mine now' })).status).toBe(403);

    expect((await call(ctx.app, bina, 'POST', '/v1/reports', { target_type: 'trail', target_id: trail.id, reason: 'spam' })).status).toBe(201);
    const [report] = (await ok(moderator, 'GET', '/v1/admin/reports')).items;
    expect(report.target).toMatchObject({ id: trail.id, title: 'Attention to BERT' });
    await ok(moderator, 'POST', `/v1/admin/reports/${report.id}/resolve`, { action: 'remove_content' });
    expect((await call(ctx.app, bina, 'GET', `/v1/trails/${trail.id}`)).status).toBe(404);
    expect((await ok(ali, 'GET', `/v1/trails/${trail.id}`)).status).toBe('removed');
  });
});

describe('A13 Learn before reading', () => {
  it('links each prerequisite to our content and computes what is done', async () => {
    const { admin, attention } = await seedCollection();
    const user = await createUser(ctx.app, 'ali');
    await ok(admin, 'POST', '/v1/admin/topics', { name: 'Softmax', summary: 'Scores to probabilities.' });
    await ok(admin, 'POST', '/v1/admin/topics', { name: 'Attention mechanism' });
    const lesson = await ok(admin, 'POST', '/v1/admin/learn-items', { topic: 'softmax', title: 'Softmax, step by step', kind: 'text', body: 'Raise e to each score and divide by the sum.' });
    await ok(admin, 'PUT', `/v1/admin/learn-items/${lesson.id}/status`, { status: 'published' });

    await ok(admin, 'PUT', `/v1/admin/papers/${attention.id}/prerequisites`, {
      items: [
        { topic: 'softmax', why: 'Attention weights are a softmax.', link: { kind: 'learn_item', id: lesson.id }, suggested_by: 'ai' },
        { topic: 'attention-mechanism', label: 'What attention does' },
      ],
    });

    const before = await ok(user, 'GET', `/v1/papers/${attention.id}/learn-first`);
    expect(before).toMatchObject({ total: 2, ready: 0, ai_suggested: true });
    expect(before.topics[0]).toMatchObject({ slug: 'softmax', why: 'Attention weights are a softmax.', link: { kind: 'note', id: lesson.id, minutes: 1 }, done: false });
    expect(before.topics[1]).toMatchObject({ label: 'What attention does', link: null, done: false });

    await ok(user, 'PUT', `/v1/learn-items/${lesson.id}/complete`);
    await ok(user, 'PUT', '/v1/topics/attention-mechanism/known');
    const after = await ok(user, 'GET', `/v1/papers/${attention.id}/learn-first`);
    expect(after).toMatchObject({ ready: 2 });
    expect(after.topics[1]).toMatchObject({ known: true, done: true });
  });
});

describe('papers split into companion tables (migration 006)', () => {
  const companions = async (publicId: string) => {
    const { id } = await db.selectFrom('papers').select('id').where('public_id', '=', publicId).executeTakeFirstOrThrow();
    const [metadata, metrics, sync] = await Promise.all([
      db.selectFrom('paper_metadata').selectAll().where('paper_id', '=', id).executeTakeFirst(),
      db.selectFrom('paper_metrics').selectAll().where('paper_id', '=', id).executeTakeFirst(),
      db.selectFrom('paper_sync').selectAll().where('paper_id', '=', id).executeTakeFirst(),
    ]);
    return { id, metadata, metrics, sync };
  };

  it('creates the companion rows with a paper and stores the summary on the English card', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    await ok(admin, 'POST', '/v1/admin/fields', { name: 'Transformers' });
    const figure = { url: 'https://cdn.example.com/fig1.png', caption: 'The Transformer' };
    const paper = await ok(admin, 'POST', '/v1/admin/papers', {
      field: 'transformers',
      title: 'Attention Is All You Need',
      paper_url: 'https://arxiv.org/abs/1706.03762',
      doi: 'https://doi.org/10.48550/ARXIV.1706.03762',
      research_questions: ['Can attention replace recurrence?', 'Does it train faster?'],
      main_idea: 'Self-attention only.',
      data_source: 'WMT 2014',
      method_steps: ['Embed', 'Attend'],
      results: 'State-of-the-art BLEU.',
      figures: [figure],
      limitations: 'Quadratic in length.',
      evaluation: 'BLEU on WMT.',
    });
    // The admin response keeps its shape.
    expect(paper).toMatchObject({
      doi: '10.48550/arxiv.1706.03762',
      research_questions: ['Can attention replace recurrence?', 'Does it train faster?'],
      main_idea: 'Self-attention only.',
      results: 'State-of-the-art BLEU.',
      figures: [figure],
      synced_at: null,
      trend_rank: null,
    });

    const rows = await companions(paper.id);
    expect(rows.metadata).toMatchObject({ doi: '10.48550/arxiv.1706.03762', arxiv_id: null, openalex_topics: [] });
    expect(rows.metrics).toEqual({ paper_id: rows.id, citation_count: null, hf_upvotes: null, hf_trending_at: null, trend_rank: null });
    expect(rows.sync).toEqual({ paper_id: rows.id, synced_at: null, sync_error: null });

    const [card] = (await ok(admin, 'GET', `/v1/admin/papers/${paper.id}/cards`)).items;
    expect(card).toMatchObject({
      lang: 'en',
      question: 'Can attention replace recurrence?',
      extra_questions: ['Does it train faster?'],
      key_idea: 'Self-attention only.',
      data_source: 'WMT 2014',
      method_steps: ['Embed', 'Attend'],
      findings: 'State-of-the-art BLEU.',
      figures: [figure],
      evaluation: 'BLEU on WMT.',
      updated_by: 'boss',
    });

    // PATCH changes only what it sends, on the card.
    const patched = await ok(admin, 'PATCH', `/v1/admin/papers/${paper.id}`, { main_idea: 'Attention, nothing else.', research_questions: ['One question'] });
    expect(patched).toMatchObject({ main_idea: 'Attention, nothing else.', research_questions: ['One question'], results: 'State-of-the-art BLEU.' });

    await ok(admin, 'PUT', `/v1/admin/papers/${paper.id}/status`, { status: 'published' });
    const user = await createUser(ctx.app, 'ali');
    const live = await ok(user, 'GET', `/v1/papers/${paper.id}`);
    expect(live).toMatchObject({ main_idea: 'Attention, nothing else.', research_questions: ['One question'], evaluation: 'BLEU on WMT.', figures: [figure] });
    expect(live.cards.en).toMatchObject({ key_idea: 'Attention, nothing else.', extra_questions: [], data_source: 'WMT 2014' });

    // A card PUT from a client that doesn't know the four moved fields leaves them as they are.
    await ok(admin, 'PUT', `/v1/admin/papers/${paper.id}/cards/en`, { question: 'One question', key_idea: 'Rewritten', takeaway: 'Read it' });
    expect((await ok(admin, 'GET', `/v1/admin/papers/${paper.id}/cards`)).items[0]).toMatchObject({
      key_idea: 'Rewritten',
      takeaway: 'Read it',
      data_source: 'WMT 2014',
      evaluation: 'BLEU on WMT.',
      figures: [figure],
    });

    // A paper without summary fields gets no card; deleting a paper removes its companions.
    const bare = await ok(admin, 'POST', '/v1/admin/papers', { field: 'transformers', title: 'Bare', paper_url: 'https://example.com/bare' });
    expect(bare).toMatchObject({ research_questions: [], method_steps: [], figures: [], main_idea: null });
    expect((await ok(admin, 'GET', `/v1/admin/papers/${bare.id}/cards`)).items).toHaveLength(0);
    const bareRows = await companions(bare.id);
    await ok(admin, 'DELETE', `/v1/admin/papers/${bare.id}`);
    for (const table of ['paper_metadata', 'paper_metrics', 'paper_sync'] as const) {
      expect(await db.selectFrom(table).select('paper_id').where('paper_id', '=', bareRows.id).executeTakeFirst()).toBeUndefined();
    }
  });

  it('keeps outside identifiers unique', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    await ok(admin, 'POST', '/v1/admin/fields', { name: 'Transformers' });
    await ok(admin, 'POST', '/v1/admin/papers/import', { field: 'transformers', arxiv_id: '1706.03762' });
    const again = await call(ctx.app, admin, 'POST', '/v1/admin/papers/import', { field: 'transformers', arxiv_id: '1706.03762' });
    expect(again.body.error.code).toBe('ALREADY_EXISTS');

    const base = { field: 'transformers', title: 'X', paper_url: 'https://example.com/x' };
    await ok(admin, 'POST', '/v1/admin/papers', { ...base, doi: '10.1000/one' });
    expect((await call(ctx.app, admin, 'POST', '/v1/admin/papers', { ...base, doi: '10.1000/ONE' })).status).toBe(409); // normalised, then unique
    const other = await ok(admin, 'POST', '/v1/admin/papers', { ...base, doi: '10.1000/two' });
    expect((await call(ctx.app, admin, 'PATCH', `/v1/admin/papers/${other.id}`, { arxiv_id: '1706.03762' })).status).toBe(409);
    expect((await call(ctx.app, admin, 'PATCH', `/v1/admin/papers/${other.id}`, { arxiv_id: '1706.03762v5' })).status).toBe(400); // no version
    expect(await ok(admin, 'PATCH', `/v1/admin/papers/${other.id}`, { doi: null })).toMatchObject({ doi: null });
    // The failed create rolled back with its companions: no orphan rows.
    expect(await db.selectFrom('papers').select(({ fn }) => fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).toEqual({ n: 3 });
  });

  it('records sync results and errors on paper_sync, and only queues papers with an identifier', async () => {
    const { admin, attention } = await seedCollection();
    expect((await companions(attention.id)).sync).toMatchObject({ synced_at: expect.any(Date), sync_error: null });
    expect((await companions(attention.id)).metadata).toMatchObject({ openalex_id: 'W1', s2_id: 's2-attention', tldr: 'Attention alone is enough.' });

    const bare = await ok(admin, 'POST', '/v1/admin/papers', { field: 'transformers', title: 'No ids', paper_url: 'https://example.com/n' });
    expect((await call(ctx.app, admin, 'POST', `/v1/admin/papers/${bare.id}/sync`)).body.error.code).toBe('NO_IDENTIFIER');

    await ok(admin, 'POST', `/v1/admin/papers/${attention.id}/sync`);
    expect((await companions(attention.id)).sync).toMatchObject({ synced_at: null });
    providers.scholarly = { ...fakeSources, openAlex: { work: async () => Promise.reject(new Error('OpenAlex is down')) } };
    expect(await syncDuePapers(silent)).toBe(1); // the paper without ids is never picked
    expect((await companions(attention.id)).sync).toMatchObject({ synced_at: expect.any(Date), sync_error: 'OpenAlex is down' });
    expect((await companions(bare.id)).sync).toMatchObject({ synced_at: null });
  });

  it('ranks only published papers, from paper_metrics', async () => {
    const { admin, attention, bert } = await seedCollection();
    expect((await companions(bert.id)).metrics).toMatchObject({ trend_rank: 1, hf_upvotes: 42, citation_count: 90000, hf_trending_at: expect.any(Date) });
    expect((await companions(attention.id)).metrics).toMatchObject({ trend_rank: 2, hf_upvotes: null, citation_count: 150000 });

    await ok(admin, 'PUT', `/v1/admin/papers/${bert.id}/status`, { status: 'archived' });
    await rankPapers();
    expect((await companions(bert.id)).metrics).toMatchObject({ trend_rank: null });
    expect((await companions(attention.id)).metrics).toMatchObject({ trend_rank: 1 });
    const user = await createUser(ctx.app, 'ali');
    expect((await ok(user, 'GET', '/v1/papers')).items.map((p: { id: string }) => p.id)).toEqual([attention.id]);
  });

  it('searches the card questions and key idea in both languages, and follows card changes', async () => {
    const { admin, attention, bert } = await seedCollection();
    const user = await createUser(ctx.app, 'ali');
    const ids = async (q: string) => (await ok(user, 'GET', `/v1/papers?q=${encodeURIComponent(q)}`)).items.map((p: { id: string }) => p.id);

    await ok(admin, 'PATCH', `/v1/admin/papers/${attention.id}`, {
      main_idea: 'Multi-head self-attention',
      research_questions: ['Is recurrence needed?', 'Does parallelism help?'],
    });
    await ok(admin, 'PUT', `/v1/admin/papers/${bert.id}/cards/bn`, { question: 'প্রশ্ন', key_idea: 'দ্বিমুখী প্রশিক্ষণ' });
    expect(await ids('multi-head')).toEqual([attention.id]);
    expect(await ids('parallelism')).toEqual([attention.id]); // an extra question
    expect(await ids('দ্বিমুখী')).toEqual([bert.id]); // the Bangla key idea
    expect((await ok(user, 'GET', '/v1/search?q=multi-head')).papers).toHaveLength(1);

    await ok(admin, 'DELETE', `/v1/admin/papers/${attention.id}/cards/en`);
    expect(await ids('multi-head')).toEqual([]);
    expect(await ids('Vaswani')).toEqual([attention.id]); // authors stay on papers
  });
});
