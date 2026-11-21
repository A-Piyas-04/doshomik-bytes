---
name: doshomik-migration
description: How to change the Doshomik Bytes database schema with node-pg-migrate SQL migrations, keep the v1 constraints and indexes intact, and regenerate Kysely types. Use for any new table, column, index or constraint in apps/api.
---

# Schema changes in apps/api

The v1 schema is migration `apps/api/migrations/1795305600000_prototype-v1-schema.sql`, which is the appendix SQL of the Prototype v1 doc, unchanged. The Prototype v1 doc is the source of truth and is never edited.

## Rules

- **Never edit a migration that has been applied.** Every change is a new file.
- **Additions only.** New capability means a new table or new column. Don't change what v1 already has. The "Left out of v1" table in the doc already lists the expected shapes, for example `course_progress (user_id, course_id, last_position)`. Build those only when the owner asks.
- Keep the v1 conventions:
  - `bigint GENERATED ALWAYS AS IDENTITY` ids. Join tables use composite primary keys.
  - `ON DELETE CASCADE` on every user-owned row.
  - Value lists as `CHECK (col IN (...))`. Update the matching list in `packages/shared/src/index.ts` in the same change.
  - `timestamptz NOT NULL DEFAULT now()` for `created_at`.
- **Index expressions must match the queries exactly.** Full-text and trigram conditions live in `apps/api/src/db/search.ts`. If you add or change a search index, change that file to the identical expression.

## Steps

1. Create the file: `pnpm --filter @doshomik/api exec node-pg-migrate create <name> -j sql`. It goes in `apps/api/migrations/`.
2. Write the SQL under `-- Up Migration`, and the exact reverse under `-- Down Migration`.
3. Apply it: `pnpm --filter @doshomik/api db:migrate`.
4. Regenerate types: `pnpm --filter @doshomik/api db:types`. Never hand-edit `src/db/types.ts`; `.kysely-codegenrc.json` maps `int8` to `number`.
5. Run `typecheck` and `test`. The test setup wipes `doshomik_test` and replays every migration, so a broken migration fails the tests.
6. Check the down migration once: `db:migrate:down`, then `db:migrate`.

Never run `DROP DATABASE` or wipe the dev database. The test database is the only one that gets reset.
