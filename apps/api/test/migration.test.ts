import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ENV } from './env';

// Migration 006 on a database of its own: migrated to 005, filled with data in the old shape,
// then moved forward and back. The other test files use doshomik_test, migrated by global-setup.

const url = new URL(TEST_ENV.DATABASE_URL);
const databaseName = `${url.pathname.slice(1)}_migration`;
const databaseUrl = Object.assign(new URL(url), { pathname: `/${databaseName}` }).toString();
const adminUrl = Object.assign(new URL(url), { pathname: '/postgres' }).toString();
const client = new pg.Client({ connectionString: databaseUrl });

const MIGRATIONS_BEFORE_006 = 6;
const migrate = (direction: 'up' | 'down', count?: number) =>
  runner({ databaseUrl, dir: 'migrations', direction, count, migrationsTable: 'pgmigrations', log: () => {} });
const rows = async <T = Record<string, unknown>>(query: string) => (await client.query(query)).rows as T[];

async function recreateDatabase(drop: boolean) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    if (!drop) await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  await recreateDatabase(false);
  await migrate('up', MIGRATIONS_BEFORE_006);
  await client.connect();
  // Paper 1: card nobody edited (migration 005's copy) while the summary moved on → the summary wins.
  // Paper 2: card a staff member edited → the card wins; the summary's extra questions are kept.
  // Paper 3: summary and a Bangla card only → an English card is made, the Bangla one is untouched.
  // Paper 4: no summary, only ids and sync state.
  await client.query(`
    INSERT INTO users (email, username) VALUES ('a@example.com', 'ann'), ('b@example.com', 'ben');
    INSERT INTO fields (name, slug) VALUES ('ML', 'ml');
    INSERT INTO papers (field_id, title, paper_url, status, research_questions, main_idea, data_source, method_steps, results,
                        figures, limitations, evaluation, doi, arxiv_id, citation_count, hf_upvotes, trend_rank, synced_at, tldr)
    VALUES (1, 'Paper one', 'https://e.com/1', 'published', '{"First question","Second question"}', 'New idea', 'ImageNet', '{"a","b"}',
            'Good results', '[{"url":"https://e.com/f.png","caption":"Figure 1"}]', 'Small data', 'Top-1 error',
            '10.1000/one', '1111.00001', 10, 3, 2, now(), 'Short');
    INSERT INTO paper_cards (paper_id, lang, question, key_idea, method_steps, findings, limitations)
    VALUES (1, 'en', 'First question', 'Old idea', '{"a","b"}', 'Good results', 'Small data');
    INSERT INTO papers (field_id, title, paper_url, status, research_questions, main_idea, method_steps, arxiv_id, citation_count, trend_rank)
    VALUES (1, 'Paper two', 'https://e.com/2', 'published', '{"Q1","Q2","Q3"}', 'Summary idea', '{"old"}', '2222.00002', 99, 1);
    INSERT INTO paper_cards (paper_id, lang, question, key_idea, method_steps, findings, updated_by)
    VALUES (2, 'en', 'Edited question', 'Card idea', '{"new 1","new 2"}', 'Card findings', 1);
    INSERT INTO paper_cards (paper_id, lang, question, key_idea) VALUES (2, 'bn', 'প্রশ্ন', 'ধারণা');
    INSERT INTO papers (field_id, title, paper_url, research_questions, main_idea, evaluation)
    VALUES (1, 'Paper three', 'https://e.com/3', '{"Only question"}', 'Third idea', 'Third evaluation');
    INSERT INTO paper_cards (paper_id, lang, question) VALUES (3, 'bn', 'বাংলা প্রশ্ন');
    INSERT INTO papers (field_id, title, paper_url, status, s2_id, openalex_id, sync_error, synced_at)
    VALUES (1, 'Paper four', 'https://e.com/4', 'published', 's2-four', 'W4', 'Timed out', now());
    SELECT refresh_paper_search(id) FROM papers;
    INSERT INTO blocks (blocker_id, blocked_id) VALUES (1, 2);
  `);
}, 60_000);

afterAll(async () => {
  await client.end();
  await recreateDatabase(true);
}, 60_000);

describe('migration 006', () => {
  it('moves paper data to the companions and the cards, keeping ids and losing nothing', { timeout: 60_000 }, async () => {
    const before = await rows('SELECT id, public_id FROM papers ORDER BY id');
    await migrate('up');

    expect(await rows('SELECT id, public_id FROM papers ORDER BY id')).toEqual(before);
    const tables = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`);
    expect(tables[0]!.n).toBe(42);
    const paperColumns = await rows<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'papers' ORDER BY column_name`);
    expect(paperColumns.map((c) => c.column_name)).toEqual(
      ['abstract', 'authors', 'code_url', 'created_at', 'created_by', 'field_id', 'id', 'paper_url', 'pdf_url', 'public_id', 'published_at',
        'published_on', 'search_vector', 'status', 'title', 'updated_at', 'updated_by', 'venue', 'year'],
    );

    expect(await rows('SELECT paper_id, doi, arxiv_id, openalex_id, s2_id, tldr FROM paper_metadata ORDER BY paper_id')).toEqual([
      { paper_id: '1', doi: '10.1000/one', arxiv_id: '1111.00001', openalex_id: null, s2_id: null, tldr: 'Short' },
      { paper_id: '2', doi: null, arxiv_id: '2222.00002', openalex_id: null, s2_id: null, tldr: null },
      { paper_id: '3', doi: null, arxiv_id: null, openalex_id: null, s2_id: null, tldr: null },
      { paper_id: '4', doi: null, arxiv_id: null, openalex_id: 'W4', s2_id: 's2-four', tldr: null },
    ]);
    expect(await rows('SELECT paper_id, citation_count, hf_upvotes, trend_rank FROM paper_metrics ORDER BY paper_id')).toEqual([
      { paper_id: '1', citation_count: 10, hf_upvotes: 3, trend_rank: 2 },
      { paper_id: '2', citation_count: 99, hf_upvotes: null, trend_rank: 1 },
      { paper_id: '3', citation_count: null, hf_upvotes: null, trend_rank: null },
      { paper_id: '4', citation_count: null, hf_upvotes: null, trend_rank: null },
    ]);
    expect(await rows('SELECT paper_id, synced_at IS NOT NULL AS synced, sync_error FROM paper_sync ORDER BY paper_id')).toEqual([
      { paper_id: '1', synced: true, sync_error: null },
      { paper_id: '2', synced: false, sync_error: null },
      { paper_id: '3', synced: false, sync_error: null },
      { paper_id: '4', synced: true, sync_error: 'Timed out' },
    ]);

    const cards = await rows(`SELECT paper_id, lang, question, extra_questions, key_idea, data_source, method_steps, findings,
                                     figures, limitations, evaluation FROM paper_cards ORDER BY paper_id, lang`);
    expect(cards).toEqual([
      {
        paper_id: '1', lang: 'en', question: 'First question', extra_questions: ['Second question'], key_idea: 'New idea',
        data_source: 'ImageNet', method_steps: ['a', 'b'], findings: 'Good results',
        figures: [{ url: 'https://e.com/f.png', caption: 'Figure 1' }], limitations: 'Small data', evaluation: 'Top-1 error',
      },
      {
        paper_id: '2', lang: 'bn', question: 'প্রশ্ন', extra_questions: [], key_idea: 'ধারণা', data_source: null,
        method_steps: [], findings: null, figures: [], limitations: null, evaluation: null,
      },
      {
        paper_id: '2', lang: 'en', question: 'Edited question', extra_questions: ['Q2', 'Q3'], key_idea: 'Card idea', data_source: null,
        method_steps: ['new 1', 'new 2'], findings: 'Card findings', figures: [], limitations: null, evaluation: null,
      },
      {
        paper_id: '3', lang: 'bn', question: 'বাংলা প্রশ্ন', extra_questions: [], key_idea: null, data_source: null,
        method_steps: [], findings: null, figures: [], limitations: null, evaluation: null,
      },
      {
        paper_id: '3', lang: 'en', question: 'Only question', extra_questions: [], key_idea: 'Third idea', data_source: null,
        method_steps: [], findings: null, figures: [], limitations: null, evaluation: 'Third evaluation',
      },
    ]);

    // The text that lost a conflict is archived, never dropped.
    expect(await rows(`SELECT entity_id, changes FROM audit_log WHERE action = 'paper.summary_migration' ORDER BY entity_id`)).toEqual([
      { entity_id: '1', changes: { kept: 'summary', replaced: { key_idea: 'Old idea' } } },
      {
        entity_id: '2',
        changes: { kept: 'card', replaced: { question: 'Q1', research_questions: ['Q1', 'Q2', 'Q3'], key_idea: 'Summary idea', method_steps: ['old'] } },
      },
    ]);

    // Search documents were rebuilt from the cards, in both languages.
    const search = async (q: string) =>
      (await rows<{ id: string }>(`SELECT id FROM papers WHERE search_vector @@ (websearch_to_tsquery('english', '${q}') || websearch_to_tsquery('bangla', '${q}')) ORDER BY id`)).map((r) => r.id);
    expect(await search('Second')).toEqual(['1']); // an extra question
    expect(await search('Third idea')).toEqual(['3']);
    expect(await search('ধারণা')).toEqual(['2']);

    expect(await rows('SELECT is_active, updated_at = created_at AS same FROM blocks')).toEqual([{ is_active: true, same: true }]);
  });

  it('rolls back to the old shape', { timeout: 60_000 }, async () => {
    await client.query('UPDATE blocks SET is_active = false');
    await migrate('down', 1);

    expect(await rows('SELECT id, research_questions, main_idea, evaluation, doi, trend_rank, sync_error FROM papers ORDER BY id')).toEqual([
      { id: '1', research_questions: ['First question', 'Second question'], main_idea: 'New idea', evaluation: 'Top-1 error', doi: '10.1000/one', trend_rank: 2, sync_error: null },
      { id: '2', research_questions: ['Edited question', 'Q2', 'Q3'], main_idea: 'Card idea', evaluation: null, doi: null, trend_rank: 1, sync_error: null },
      { id: '3', research_questions: ['Only question'], main_idea: 'Third idea', evaluation: 'Third evaluation', doi: null, trend_rank: null, sync_error: null },
      { id: '4', research_questions: [], main_idea: null, evaluation: null, doi: null, trend_rank: null, sync_error: 'Timed out' },
    ]);
    expect(await rows(`SELECT to_regclass('paper_metadata') AS t`)).toEqual([{ t: null }]);
    expect(await rows('SELECT count(*)::int AS n FROM blocks')).toEqual([{ n: 0 }]); // inactive blocks did not exist before

    await migrate('up');
    expect(await rows('SELECT count(*)::int AS n FROM paper_metadata')).toEqual([{ n: 4 }]);
  });
});
