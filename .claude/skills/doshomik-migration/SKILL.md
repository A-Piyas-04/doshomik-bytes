---
name: doshomik-migration
description: How to change the Doshomik Bytes database schema with node-pg-migrate SQL migrations, keep the constraints and indexes intact, and regenerate Kysely types. Use for any new table, column, index or constraint in apps/api.
---

# Schema changes in apps/api

## Migrations so far (`apps/api/migrations/`)

| File | Contents |
| --- | --- |
| `…000_prototype-v1-schema.sql` | Prototype v1 appendix SQL, unchanged (16 tables) |
| `…001_prototype-2.sql` | Prototype 2 appendix SQL, unchanged except its `BEGIN`/`COMMIT` (30 tables) |
| `…002_prototype-2-backfill.sql` | Slugs `NOT NULL`, post media moved into `media_assets`, `posts.media_url` and `duration_seconds` dropped, learn-item media check |
| `…003_sessions-public-id-and-2fa.sql` | Additions: `sessions.public_id`, `users.totp_*`, indexes |
| `…004_toggles-and-stored-counts.sql` | Toggle rows (`post_likes.is_active`, `follows.status = 'inactive'`), stored `users.follower_count`/`following_count`, unread and suggestion indexes, drops the redundant Prototype 1 reels index |
| `…005_research-collection.sql` | Research tab Group A: paper metadata, `paper_cards`, `bangla` search config and `refresh_paper_search()`, `paper_saves`, `reading_passes`, `research_outputs`, `paper_edges`, `trails`, Learn before reading links, `user_known_topics`, `learn_item_completions` |
| `…006_papers-split-and-block-toggle.sql` | `blocks.is_active`/`updated_at` (toggle rows); `paper_metadata`, `paper_metrics`, `paper_sync` (one-to-one, `paper_id` PK/FK cascade, created with each paper by `createPaperCompanions`); the old summary columns moved into `paper_cards`; `refresh_paper_search()` reads the cards. 42 tables |
| `…007_learn-areas.sql` | `topics.field_id` and `courses.field_id`: learn areas are the `fields`, shared by every tab's chips |

Never edit the Prototype v1 doc or the Prototype 2 doc.

## Rules

- **Never edit a migration that has been applied.** Every change is a new file.
- **Additions over rewrites.** New capability means a new table or column. Change an existing constraint only when the feature needs it, and say why in the file's header comment.
- Keep the conventions:
  - `bigint GENERATED ALWAYS AS IDENTITY` internal ids. User-facing rows also get `public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`.
  - `ON DELETE CASCADE` for user-owned rows. `SET NULL` where history must survive (comments, reports, audit).
  - Value lists as `CHECK (col IN (...))`. Update the list in `packages/shared/src/index.ts` in the same change.
  - `created_at` and `updated_at timestamptz NOT NULL DEFAULT now()`.
  - Team content gets `status` (`draft`/`published`/`archived`), `published_at`, `created_by` and `updated_by`.
  - Paper data goes where its kind lives: outside ids and source data in `paper_metadata`, counts and rank in `paper_metrics`, queue state in `paper_sync`, explanations in `paper_cards`. Any code that inserts a paper calls `createPaperCompanions` in the same transaction.
  - Undoable relationships with side effects are toggle rows (`post_likes.is_active`, `follows.status`, `blocks.is_active`): reads filter on the state, which stays out of indexes.
- **Index expressions must match the queries exactly.** Search conditions live in `src/db/search.ts`; visibility conditions in `src/db/visibility.ts`.
- Every migration has a working `-- Down Migration`.

## Steps

1. Create the file: `pnpm --filter @doshomik/api exec node-pg-migrate create <name> -j sql`.
2. Write the SQL under `-- Up Migration` and its exact reverse under `-- Down Migration`.
3. Apply it with `pnpm --filter @doshomik/api db:migrate`, then check the round trip: `db:migrate:down`, then `db:migrate` again.
4. Regenerate types with `pnpm --filter @doshomik/api db:types`. Never hand-edit `src/db/types.ts`. `.kysely-codegenrc.json` maps `int8` to `number` and leaves out `pgmigrations`.
5. Run `typecheck` and `test`. The test setup wipes `doshomik_test` and replays every migration.
6. Record the decision in `docs/prototype-2-implementation-notes.md`.

If the dev database is unreachable, run migrations and tests on a throwaway cluster instead of editing types by hand:
`initdb -D <scratch>/data -U dev --auth=trust --encoding=UTF8 --locale=C`, `pg_ctl -D <scratch>/data -o "-p 55432" start`, then `TEST_DATABASE_URL=postgresql://dev@localhost:55432/doshomik_test pnpm test`, and `kysely-codegen --url postgresql://dev@localhost:55432/<db>` for the types. Stop it with `pg_ctl stop` afterwards.

Never run `DROP DATABASE` or wipe the dev database. Only the test database gets reset.
