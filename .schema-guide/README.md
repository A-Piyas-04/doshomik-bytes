# .schema-guide

Generates [`docs/schema-guide.html`](../docs/schema-guide.html), an interactive guide to the database
schema in [`apps/api/migrations/`](../apps/api/migrations/). Nothing in this folder is imported by
the app, and the app does not depend on it.

- `facts.json` — the schema, read from a database. Regenerated, so don't hand-edit it except to
  re-add links the database does not enforce (`"enforced": false`): today that is the four
  `reports.target_id` links, which are polymorphic and have no foreign key.
- `guide.json` — the words people read: areas, table purposes, column notes, the tour, reference
  topics. Hand-written; the generator never touches it.
- `facts.prev.json` — the previous `facts.json`, written by `read` so changes can be diffed. Ignored
  by git.

## Regenerate

Run `/schema-guide:update` in Claude Code, which does all of the below. By hand:

The guide is read from `doshomik_guide`, a throwaway database holding nothing but the migrations, so
the guide can never pick up drift from the dev database. Rebuild it first, with the local cluster up
(`pnpm db:up` in `apps/api`):

```sh
psql "postgresql://dev@localhost:55433/postgres" -c "drop database if exists doshomik_guide"
psql "postgresql://dev@localhost:55433/postgres" -c "create database doshomik_guide"
cd apps/api && DATABASE_URL=postgresql://dev@localhost:55433/doshomik_guide npx node-pg-migrate up -m migrations
```

Then, from the repo root, with `CLI` the schema-guide plugin's `scripts/schema-guide.mjs`:

```sh
node $CLI read "postgresql://dev@localhost:55433/doshomik_guide"   # prints the change list
# re-add the unenforced reports.target_id links to facts.json
node $CLI build --out docs/schema-guide.html
node $CLI check --browser --out docs/schema-guide.html
```

Editing `guide.json` alone needs only `build` and `check`.

## Keep in step

- [`docs/architecture/database-architecture.md`](../docs/architecture/database-architecture.md) has
  its own status line naming the latest migration.
- [`.api-guide/README.md`](../.api-guide/README.md) — the API guide takes its table colours from the
  `areas` in `guide.json`.
