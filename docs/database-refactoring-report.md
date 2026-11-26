# Database refactoring report

Nov 26, 2026 · migration `apps/api/migrations/1795305600006_papers-split-and-block-toggle.sql`

The schema goes from **39 to 42 tables** (verified on a database built from all seven migrations: three new tables, none removed). Paper ids, public ids and every existing foreign key to `papers(id)` are unchanged. Decisions are also logged in [implementation notes §2.9](prototype-2-implementation-notes.md#29-database-refactoring-migration-006-26-nov-2026). The interactive guide is [`schema-guide.html`](schema-guide.html).

## 1. Changes implemented

| # | Change | Where |
| --- | --- | --- |
| 1 | `blocks` became a toggle row: `is_active` and `updated_at` were added. Unblocking deactivates the row, blocking again reactivates it, and `created_at` is kept. Every block check filters on `is_active`. | Migration §1; `db/visibility.ts` (`notBlocked`), `worker/notify.ts`, `users.service.ts` (`block`, `unblock`, `listBlocks`) |
| 2 | Report targets are checked against the table that `target_type` names. They must exist and be visible to the reporter. No foreign key was added (that is intentional). | `reports.service.ts`, `comments.service.ts` (`visibleComment` exported) |
| 3 | `papers` was split into `paper_metadata`, `paper_metrics` and `paper_sync`. Each is one-to-one, with `paper_id` as both primary key and foreign key, `ON DELETE CASCADE`. The API creates all three with each paper. | Migration §2; `research.service.ts` (`createPaperCompanions`), admin research routes, `worker/papers.ts`, seed |
| 4 | `paper_cards` is now the only home of the structured explanation. Eight summary columns moved out of `papers`, and four card columns were added for content that had no equivalent. | Migration §3; admin routes (`splitPaperBody`, `writeSummaryToCard`), `research.service.ts` (`summaryFromEnglishCard`) |
| 5 | `refresh_paper_search()` reads both cards (question, extra questions, key idea) instead of `papers.main_idea`. Every search document was rebuilt. | Migration §4 |
| 6 | The trend and sync indexes were moved to the tables that now hold their columns. The four unique identifiers and three CHECKs moved with their columns. | Migration §2, §5 |

These were left unchanged, as specified: `fields.slug` and `fields.position`, the separate paper, PDF and code URLs, abstract and TLDR, trails, saves, reading passes, edges, prerequisites, roadmaps and comments. The polymorphic ids in `audit_log` and `outbox_events` were not touched.

## 2. Before and after

**`blocks`**

| Before | After |
| --- | --- |
| blocker_id, blocked_id (PK, both FK → users, cascade), created_at | Same, plus `is_active boolean NOT NULL DEFAULT true` and `updated_at timestamptz NOT NULL DEFAULT now()`. Existing rows: active, `updated_at = created_at` |

**`papers`** (39 columns → 19)

| Kept on `papers` | Moved |
| --- | --- |
| id, public_id, field_id, title, authors, year, abstract, venue, published_on, paper_url, pdf_url, code_url, status, published_at, created_by, updated_by, created_at, updated_at, search_vector | 6 to `paper_metadata`, 4 to `paper_metrics`, 2 to `paper_sync`, 8 into `paper_cards` |

**New tables**

| Table | Columns | Constraints and indexes |
| --- | --- | --- |
| `paper_metadata` | paper_id, doi, arxiv_id, openalex_id, s2_id, openalex_topics jsonb, tldr | PK/FK `paper_id` (cascade); UNIQUE on each of the four ids |
| `paper_metrics` | paper_id, citation_count, hf_upvotes, hf_trending_at, trend_rank | PK/FK `paper_id` (cascade); CHECK `citation_count >= 0`, `hf_upvotes >= 0`, `trend_rank > 0`; `paper_metrics_trend_idx ((coalesce(trend_rank, 2147483647)), paper_id)` |
| `paper_sync` | paper_id, synced_at, sync_error | PK/FK `paper_id` (cascade); `paper_sync_due_idx (synced_at NULLS FIRST, paper_id)` |

**`paper_cards`**: added `extra_questions text[] NOT NULL DEFAULT '{}'`, `data_source text`, `evaluation text` and `figures jsonb NOT NULL DEFAULT '[]'`. The key stays `(paper_id, lang)`, so a paper can still have one card per language.

**Indexes**

| Before (on `papers`) | After |
| --- | --- |
| `papers_trend_idx … WHERE status = 'published'` | `paper_metrics_trend_idx`. A partial index can't reference `papers.status`, so the query joins `papers` for status. Only published papers keep a rank. |
| `papers_sync_idx … WHERE doi IS NOT NULL OR arxiv_id IS NOT NULL` | `paper_sync_due_idx`. The identifier test is a primary-key lookup on `paper_metadata`. |
| `papers_search_idx` (GIN), `papers_field_id_idx` | Unchanged |

`EXPLAIN` shows that both new indexes are read in order by the list and queue queries.

## 3. Column migration mapping

| Old column | New home |
| --- | --- |
| `papers.doi`, `arxiv_id`, `openalex_id`, `s2_id`, `openalex_topics`, `tldr` | `paper_metadata`, same names and types |
| `papers.citation_count`, `hf_upvotes`, `hf_trending_at`, `trend_rank` | `paper_metrics`, same names and types |
| `papers.synced_at`, `sync_error` | `paper_sync`, same names (`synced_at` NULL still means "queued") |
| `papers.research_questions[1]` | English card `question` |
| `papers.research_questions[2:]` | English card `extra_questions` **(new)** |
| `papers.main_idea` | English card `key_idea` |
| `papers.results` | English card `findings` |
| `papers.method_steps`, `limitations` | English card, same names |
| `papers.data_source`, `evaluation`, `figures` | English card, same names **(new columns)** |

## 4. Important implementation decisions

- **Which side wins when a card and the old summary disagree.** A card that someone edited (`updated_by` set, or `source = 'ai'`) wins. A card nobody edited is the copy that migration 005 made, and the summary columns kept being edited after that through `PATCH /admin/papers`, so the summary wins there. Empty fields are always filled from the other side. Bangla cards are not touched.
- **Nothing is discarded.** For every real conflict, the losing text goes into an `audit_log` row (`action = 'paper.summary_migration'`, `actor_id` NULL, `changes = {kept, replaced}`). When a card's question wins, that row also keeps the full original `research_questions` list.
- **The API contracts are kept.** `GET /v1/papers/:id` and the admin paper endpoints still return and accept `research_questions`, `main_idea`, `data_source`, `method_steps`, `results`, `figures`, `limitations` and `evaluation`. These fields now read and write the English card. Cards gain the four new fields. A card `PUT` that leaves them out keeps their current values, so a client written before 006 can't wipe moved content.
- **Companion rows are created by the application, not a trigger.** `createPaperCompanions` runs in the same transaction as each paper insert: admin create, import and the seed. This matches the codebase, which avoids triggers and refreshes search explicitly. Public lists and the sync queue use inner joins. The admin list uses left joins, so staff can still see a paper that is missing its rows.
- **Report targets.**
  - User: active, and not the reporter (`400 SELF_REPORT`). Blocked users can still be reported.
  - Post and trail: visible to the reporter.
  - Comment: live and in a thread the reporter can see, including comments by someone the reporter blocked.
  - Anything else: `404`.
- **Blocks list.** `GET /me/blocks` lists active blocks. `blocked_at` is when the current block began (`updated_at`).
- **Down migration.** It restores the old columns, constraints, indexes and search function. The English card's current content is copied back into the summary columns, and inactive blocks are deleted because they did not exist before.

## 5. Modified files

- **New:** `apps/api/migrations/1795305600006_papers-split-and-block-toggle.sql`, `apps/api/test/migration.test.ts`, this report.
- **API:** `src/db/types.ts` (regenerated with `kysely-codegen`), `src/db/visibility.ts`, `src/modules/admin/research.routes.ts`, `src/modules/comments/comments.service.ts`, `src/modules/reports/reports.service.ts`, `src/modules/research/research.service.ts`, `src/modules/users/users.service.ts`, `src/scripts/seed.ts`, `src/worker/notify.ts`, `src/worker/papers.ts`.
- **Tests:** `test/research.test.ts`, `test/social.test.ts`.
- **Docs:** `apps/api/README.md`, `docs/architecture/database-architecture.md`, `docs/architecture/backend-architecture.md`, `docs/prototype-2-implementation-notes.md` (§2.9, and two older decisions marked as superseded), `.claude/skills/doshomik-migration/SKILL.md`.
- **Schema guide:** `.schema-guide/facts.json` (re-read from the live schema; the four `enforced: false` `reports.target_id` links were restored), `.schema-guide/guide.json`, `docs/schema-guide.html`.
- `packages/shared` is unchanged: no value list changed.

## 6. Test results

All runs used a throwaway PostgreSQL 18.1 cluster (port 55432), because the dev database still rejects the `.env` password.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `vitest run` | **58/58 pass** in 7 files (48 existing + 10 new) |
| New tests | Block, unblock and reblock (one row, `created_at` kept, feed and follow behaviour, list). Notifications after an unblock. Report validation for every type: missing, wrong kind, self, deleted, hidden thread, suspended, blocked author. Companion rows on create and import, and their cascade on delete. The summary stored on the English card through create and PATCH, with an old-style card PUT keeping moved fields. Unique and normalised identifiers. Sync success and failure on `paper_sync`, with papers that have no ids never queued. Ranking from `paper_metrics`, with archived papers unranked. Search on extra questions, the English and Bangla key idea, and after a card delete. |
| `test/migration.test.ts` | Builds its own database at 005 with old-shape data covering an untouched card, an edited card, a Bangla-only card and an ids-only paper. Then it runs 006 and checks ids, the 42-table count, the `papers` columns, all three companions, every card, the audit archive, search and blocks. Then down, then up again. |
| Manual | Up → down → up on seeded data. A fresh database migrated from zero. `pnpm db:seed` on a fresh database. `EXPLAIN` of both relocated indexes. The schema is identical after the final edit of 006. |
| Schema guide | `build` and `check --browser` pass: 312 pages, 42 tables, 83 links (79 foreign keys + 4 unenforced). |

## 7. Remaining issues and manual actions

1. **Run `pnpm --filter @doshomik/api db:migrate` on the dev database** once its password is fixed. Then look at `SELECT * FROM audit_log WHERE action = 'paper.summary_migration'`, where any card/summary conflicts are archived.
2. **Every new code path that inserts a paper must call `createPaperCompanions`.** Otherwise the paper is missing from public lists and the sync queue. If that ever proves error-prone, an `AFTER INSERT` trigger on `papers` is the alternative.
3. **Papers without a DOI or arXiv id sit at the head of `paper_sync_due_idx`.** Each sync round skips them with a primary-key lookup. This is negligible for a curated collection, but revisit it if there are thousands of such papers.
4. **A staff summary edit through `PATCH /admin/papers` keeps the card's `source`.** `source` records who created the card.
5. **Schema guide warning:** the Research area now has 16 tables. Splitting it, for example into "collection" and "reading", is optional.
6. `docs/architecture/Schema-Explorer.html` was an older, hand-made explorer that still described the schema before 006. It was deleted on Nov 26, 2026; `docs/schema-guide.html` is the current guide.
7. The Prototype v1 and Prototype 2 docs were not edited, by project rule. Their schema appendices predate this change.
