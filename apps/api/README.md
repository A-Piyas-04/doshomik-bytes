# Doshomik Bytes API (Prototype v1)

The Node.js backend for Prototype v1: Fastify, PostgreSQL (16 tables, via Kysely) and local media storage.
Scope, flows and schema come from `docs/Prototype v1 — Features, User Flows & Database Schema.md`.

## Setup

Requirements: Node.js 22+, pnpm, PostgreSQL 16+ with a `dev` role (`CREATE ROLE dev LOGIN PASSWORD 'dev' CREATEDB;`), and FFmpeg (`ffprobe` checks reel length).

```sh
pnpm install                      # from the repo root
cd apps/api
cp .env.example .env              # then set JWT_SECRET and SEED_ADMIN_PASSWORD
createdb -U dev -h localhost doshomik
pnpm db:migrate                   # runs migrations/ (001 is the appendix SQL, unchanged)
pnpm db:seed                      # first admin + starter content
pnpm dev                          # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `pnpm dev` / `pnpm start` | Run the API (watch mode / plain) |
| `pnpm test` | Vitest against `doshomik_test` (created and wiped automatically) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:migrate` / `db:migrate:down` | Apply / roll back migrations |
| `pnpm db:types` | Regenerate `src/db/types.ts` from the live database after a migration |
| `pnpm db:seed` | Create the admin from `SEED_ADMIN_*`; add starter content to an empty database |

## Layout

```
migrations/            SQL migrations (node-pg-migrate). Never edit one that has been applied.
src/
  app.ts               Builds the Fastify app: plugins, auth boundary, route modules
  server.ts            Starts the server and shuts down cleanly
  config/env.ts        Environment variables, validated with zod
  db/                  Kysely instance, generated table types, Postgres error codes, search expressions
  lib/                 Auth hooks, errors, validation helpers, pagination, storage, uploads
  modules/<area>/      <area>.routes.ts (HTTP + validation) and <area>.service.ts (queries and rules)
  scripts/             Seed script and its data
test/                  Route tests through fastify.inject
```

## Conventions

- **Auth.** `Authorization: Bearer <token>` on every route except `/auth/*`, `/health` and `/media/*`. Tokens are JWTs signed with `JWT_SECRET`.
- **Admins.** `/admin/*` needs `users.role = 'admin'`, checked against the database on each request.
- **Errors.** Always `{ "error": { "code", "message", "details"? } }`. Clients branch on `code`, for example `USERNAME_TAKEN`, `EMAIL_TAKEN`, `SELF_FOLLOW`, `VIDEO_TOO_LONG` or `VALIDATION_ERROR`.
- **Lists.** Paginated lists return `{ items, next_cursor }`. Pass `?cursor=<next_cursor>&limit=<1-50>` for the next page. Ordering is keyset on `(created_at, id)`, never offset.
- **Media.** Uploads are `multipart/form-data` with one file. Files are stored under `MEDIA_DIR` and served at `MEDIA_BASE_URL`. Images (JPEG, PNG, WebP) can be up to 10 MB and are checked by their file signature. Videos (MP4, MOV, WebM) can be up to 100 MB and are checked by ffprobe. Reels are at most 90 s (`REEL_MAX_SECONDS` in `@doshomik/shared`).
- **Ids** are numbers. Timestamps are ISO strings.

## Endpoints

**Account**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/signup` | `{ email, username, password }` → `{ token, user }`. Rate limited. |
| POST | `/auth/login` | `{ login, password }`, where `login` is an email or username. Rate limited. |
| GET / PATCH | `/me` | Own account; PATCH `{ display_name?, bio? }` (`""` clears a field) |
| PUT | `/me/avatar` | multipart, one image |
| GET | `/users/:id` | Profile with `posts_count`, `followers_count`, `following_count`, `is_following` |
| GET | `/users/suggestions` | People to follow, for the empty Home state |
| PUT / DELETE | `/users/:id/follow` | Follow (notifies) / unfollow |

**Social**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/posts` | multipart `type` (`text`, `image` or `reel`), `caption`, plus one file for image and reel posts. A text post may send JSON instead. |
| GET / DELETE | `/posts/:id` | Only the author can delete |
| GET | `/feed` | Posts by people you follow, newest first |
| GET | `/reels` | Reel posts only |
| GET | `/users/:id/posts` | A user's posts |
| PUT / DELETE | `/posts/:id/like` | Like (notifies the author) / unlike |
| GET / POST | `/posts/:id/comments` | Top-level comments, oldest first. POST `{ body, parent_id? }`; a reply notifies the parent's author. |
| GET | `/comments/:id/replies` | Replies to a comment |

**Learn and Practice**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/topics`, `/topics/:id` | A topic includes its learn items |
| GET | `/learn-items?topic_id=`, `/learn-items/:id` | |
| GET | `/courses`, `/courses/:id` | A course includes its items in order. External courses have `external_url`. |
| GET | `/practice/questions?topic_id=&limit=` | Random order; leave out `topic_id` for Random. Answers are not included. |
| POST | `/practice/questions/:id/answer` | `{ answer }` → `{ correct, correct_answer, explanation }`. Nothing is stored. |

**Research**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/fields` | |
| GET | `/papers?field_id=&q=` | Paper cards with your `my_status` |
| GET | `/papers/:id` | Full structured summary |
| GET | `/papers/:id/learn-first` | Topics in order with their learn items, plus `topic_count` and `topics_with_learn_items` |
| PUT / DELETE | `/papers/:id/status` | `{ status: saved, reading or completed }` / remove from the tracker |
| GET | `/users/:id/papers` | Tracker grouped into `saved`, `reading` and `completed` |
| GET | `/fields/:id/roadmap` | Steps `{ position, note, paper }` in reading order |
| GET / POST | `/papers/:id/comments` | Paper discussion; same shape as post comments |

**Across the app**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications` | Newest first. `paper_id` is set for replies in a paper discussion. |
| GET | `/notifications/unread-count` | `{ count }` |
| POST | `/notifications/:id/read` | |
| GET | `/search?q=&type=&limit=` | Grouped as `users`, `posts`, `topics`, `learn_items`, `courses` and `papers`. Pass `type` to get one group ("See all"). |

**Admin content (role = admin)**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/admin/media` | multipart, one image or video → `{ url, kind, duration_seconds }` |
| POST · PATCH · DELETE | `/admin/topics[/:id]`, `/admin/fields[/:id]`, `/admin/learn-items[/:id]`, `/admin/courses[/:id]`, `/admin/questions[/:id]`, `/admin/papers[/:id]` | Create, update and delete content |
| GET | `/admin/questions?topic_id=` | Includes answers |
| PUT | `/admin/courses/:id/items` | `{ item_ids }` in step order |
| PUT | `/admin/papers/:id/prerequisites` | `{ topic_ids }` in Learn first order |
| PUT | `/admin/fields/:id/roadmap` | `{ steps: [{ paper_id, note }] }` in reading order |

## Not in this backend (by design)

Everything under "Left out of v1" in the Prototype v1 doc. Also left out for local v1:

- The Redis/BullMQ transcode queue. Reels are validated with ffprobe and stored as uploaded.
- Docker, Caddy and object-storage SDKs. Storage sits behind the `Storage` interface in `src/lib/storage.ts`, so the VPS or S3/R2 can replace local disk later.
