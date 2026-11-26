# Doshomik Bytes API (Prototype 2)

The backend: a Fastify API and a background worker on PostgreSQL (39 tables, via Kysely).

- **Scope:** `docs/Prototype 2 — Features, Database, Security & Efficiency.md`, on top of `docs/Prototype v1 — Features, User Flows & Database Schema.md`.
- **Decisions, and what is deferred (Redis, Elasticsearch, S3/CDN, FCM…):** `docs/prototype-2-implementation-notes.md`.

## Setup

Requirements:

- Node.js 22+ and pnpm
- PostgreSQL 16+ with a `dev` role: `CREATE ROLE dev LOGIN PASSWORD 'dev' CREATEDB;`
- FFmpeg (`ffmpeg` and `ffprobe` on PATH)

```sh
pnpm install                      # from the repo root
cd apps/api
cp .env.example .env              # then set APP_SECRET and SEED_ADMIN_PASSWORD
createdb -U dev -h localhost doshomik
pnpm db:migrate                   # Prototype 1 schema, Prototype 2 migration, backfill, additions
pnpm db:seed                      # first admin + starter content
pnpm dev                          # API on http://localhost:3000
pnpm worker                       # in a second terminal: media, notifications, email, paper ingestion, maintenance
```

### Auth is off during development (`DEV_AUTH_BYPASS`)

While the app and admin panel are being built, `DEV_AUTH_BYPASS=true` (the `.env.example` default) skips sign-in:

- A request **without** an `Authorization` header acts as `DEV_AUTH_USER` (default `admin`), with no token and no two-factor step, so the admin API opens at once.
- Send `x-dev-user: learner1` (or `learner2`, both created by `pnpm db:seed`, password `devpassword`) to act as an ordinary user, e.g. to test follows and likes between two accounts.
- A request **with** a token still goes through real auth, so the sign-in flows can be tested at any time.
- The API refuses to start with the bypass on when `NODE_ENV=production`.

Turning auth back on (planned for the end of development) means setting `DEV_AUTH_BYPASS=false`. The clients must then sign in, and the seeded admin must turn on two-factor sign-in before the admin API opens:

1. `POST /v1/me/2fa/setup` → add the `otpauth_url` to an authenticator app.
2. `POST /v1/me/2fa/enable { code }`.

In development, emails are written to `.dev-mail/` instead of being sent. Set `SMTP_URL` to send them for real.

| Script | What it does |
| --- | --- |
| `pnpm dev` / `pnpm start` | Run the API (watch mode / plain) |
| `pnpm worker` | Run the background worker (only one at a time) |
| `pnpm test` | Vitest against `doshomik_test` (created, wiped and migrated automatically) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:migrate` / `db:migrate:down` | Apply / roll back migrations |
| `pnpm db:types` | Regenerate `src/db/types.ts` from the live database |
| `pnpm db:seed` | Create the admin from `SEED_ADMIN_*`; add starter content to an empty database |

## Layout

```
migrations/              SQL migrations (node-pg-migrate). Never edit one that has been applied.
src/
  app.ts                 Fastify app: plugins, /v1, the auth boundary, route modules
  server.ts              API process
  worker.ts              Worker process: media loop, outbox loop, papers loop, hourly maintenance
  config/env.ts          Environment variables, validated with zod
  db/                    Kysely instance, generated types, visibility rules, search expressions, pg error codes
  lib/                   auth hooks, crypto (derived keys, signed tokens), errors, pagination, outbox, audit,
                         rate limits, storage, TOTP, validation
  providers/             Email, push, Google sign-in and scholarly sources (OpenAlex, Semantic Scholar,
                         Hugging Face), each behind an interface; tests swap in fakes
  modules/<area>/        <area>.routes.ts (HTTP + validation) and <area>.service.ts (queries and rules)
  worker/                media.ts (sharp + ffmpeg), outbox.ts (event handlers), notify.ts, papers.ts
                         (paper ingestion and trend rank), maintenance.ts
test/                    Route tests through fastify.inject, worker run in-process
```

## Conventions

- **Versioned.** Every API route is under `/v1`.
- **Public ids only.** `id` fields are UUIDs; topics and fields are named by `slug`. Internal numeric ids never leave the server, and cursors are encrypted.
- **Auth.** Send `Authorization: Bearer <access_token>`. Access tokens last 15 minutes. `POST /v1/auth/refresh` swaps the refresh token for a new pair; each refresh token works once, and reusing one ends that session.
- **Visibility.** Blocks, private accounts, drafts, deleted items and suspended accounts are applied by `src/db/visibility.ts` in every query. Something you may not see returns 404.
- **Staff.** `/v1/admin/*` requires the moderator or admin role **and** two-factor sign-in.
- **Errors.** Always `{ "error": { "code", "message", "request_id", "details"? } }`. Clients branch on `code`, for example `USERNAME_TAKEN`, `TOO_MANY_ATTEMPTS`, `REFRESH_TOKEN_REUSED`, `MFA_REQUIRED`, `MEDIA_NOT_READY` or `VALIDATION_ERROR`.
- **Lists.** Paginated lists return `{ items, next_cursor }`. Pass `?cursor=…&limit=1–50` for the next page.
- **Eventually consistent.** Like and comment counts, notifications, push and email come from the worker, usually within a second. The app should show likes optimistically.

## Uploading media

1. `POST /v1/media/uploads { kind, purpose, mime_type, size_bytes }` returns `{ media: { id }, upload: { url, method, headers, expires_at } }`.
   - `purpose` is `post`, `avatar`, `learn` or `paper_figure`; `learn` and `paper_figure` are for admins only.
   - Limits: images (JPEG, PNG, WebP) up to 15 MB; videos (MP4, MOV, WebM) up to 150 MB, or 1 GB for learn videos.
2. `PUT` the file bytes to `upload.url` with the given headers. The link expires after 15 minutes.
3. `POST /v1/media/:id/complete`. The asset becomes `processing`.
4. Use the id:
   - posts: `POST /v1/posts { type: "reel", media_id }`; the post waits as `processing` and is published when the media is ready, with a `post_ready` notification;
   - learn items: `media_id` on create or update;
   - avatars: applied automatically when ready.
5. `GET /v1/media/:id` shows `status` (`processing`, `ready` or `failed`) and `error`.

What the worker does:

- **Images** become WebP variants: `thumbnail_url` (320), `url` (1080) and `full_url` (2048).
- **Videos** become an HLS ladder (`url` is the master playlist) plus a poster (`thumbnail_url`).
- Metadata such as GPS is stripped. Reels over 90 s fail.

## Endpoints (all under `/v1`)

**Auth and sessions**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/signup` | `{ email, username, password, platform, app_version? }` → tokens + user. Sends a verification email. |
| POST | `/auth/login` | `{ login, password, platform }`. With 2FA on, returns `{ mfa_required, mfa_token }` instead of tokens. |
| POST | `/auth/login/mfa` | `{ mfa_token, code }` → tokens |
| POST | `/auth/google` | `{ id_token, platform }` → tokens (or the MFA challenge) |
| POST | `/auth/refresh` | `{ refresh_token }` → a new token pair |
| POST | `/auth/logout` | Ends this session |
| POST | `/auth/verify-email` | `{ token }` from the email |
| POST | `/auth/resend-verification` | |
| POST | `/auth/password-reset/request` | `{ email }`; always 202 |
| POST | `/auth/password-reset/confirm` | `{ token, password }`; signs out every device |
| GET / DELETE | `/sessions`, `/sessions/:id` | Signed-in devices; sign one out |
| PUT | `/sessions/current/push-token` | `{ push_token }` (FCM) |
| POST · POST · DELETE | `/me/2fa/setup`, `/me/2fa/enable`, `/me/2fa` | Two-factor sign-in |

**Account and people**

| Method | Path | Notes |
| --- | --- | --- |
| GET / PATCH / DELETE | `/me` | PATCH `{ display_name?, bio?, is_private? }`. DELETE `{ password }` starts deletion: hidden at once, purged after 30 days. |
| GET / PUT | `/me/interests` | `{ fields: [slug] }` from onboarding |
| GET | `/me/follow-requests` | Pending requests to a private account |
| POST / DELETE | `/me/follow-requests/:id/accept`, `/me/follow-requests/:id` | Accept / decline (`:id` = requester) |
| GET | `/me/blocks`, `/me/saved`, `/me/courses` | Active blocks (`blocked_at` = when the current block began), saved posts, courses in progress |
| GET | `/users/suggestions`, `/users/:id`, `/users/:id/posts`, `/users/:id/papers` | Profile has `follow_status`: `none`, `pending` or `accepted` |
| PUT / DELETE | `/users/:id/follow` | Returns `{ status: accepted }`, or `pending` for a private account |
| PUT / DELETE | `/users/:id/block` | Hides both users from each other everywhere, ends follows. Unblocking keeps the row as inactive; blocking again reactivates it |
| POST | `/reports` | `{ target_type: user, post, comment or trail; target_id; reason; details? }`. The target must exist in that type's table and be visible to the reporter (a live comment in a visible thread; an active user), else `404`; reporting yourself is `400 SELF_REPORT` |

**Media and social**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/media/uploads`, `/media/:id/complete` | See *Uploading media* |
| GET | `/media/:id` | Your upload's status |
| POST | `/posts` | `{ type, caption?, media_id?, topic? }`. `topic` (a topic slug) tags a reel with a concept, so Learn before reading can link it |
| GET / DELETE | `/posts/:id` | Delete is a soft delete, purged after 30 days |
| GET | `/feed`, `/reels` | Home (accepted follows) and Reels, newest first |
| PUT / DELETE | `/posts/:id/like`, `/posts/:id/save` | |
| GET / POST | `/posts/:id/comments`, `/papers/:id/comments` | `{ body, parent_id? }` |
| GET / DELETE | `/comments/:id/replies`, `/comments/:id` | Deleted comments stay as `is_deleted` placeholders |

**Learn, Practice, Research**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/topics`, `/topics/:slug` | |
| PUT / DELETE | `/topics/:slug/known` | "I already know this" |
| GET | `/learn-items?topic=`, `/learn-items/:id` | |
| PUT / DELETE | `/learn-items/:id/complete` | Completed lessons and notes (course progress also marks the steps it reaches) |
| GET | `/courses`, `/courses/:id` | With `my_progress` |
| PUT | `/courses/:id/progress` | `{ last_position }`; the last step marks the course completed |
| GET | `/practice/questions?topic=&limit=` | Random; no answers |
| POST | `/practice/questions/:id/answer` | `{ answer }` → `{ correct, correct_answer, explanation }`; recorded |
| GET | `/me/practice/history`, `/me/practice/stats` | Stats give accuracy per topic and `streak_days` |
| GET | `/quizzes?topic=`, `/quizzes/:id` | |
| GET | `/fields`, `/fields/:slug/roadmap` | Fields are the topic chips, in `position` order |
| GET | `/papers?field=&q=&interests=true&sort=trend\|newest` | Default order is the trend rank kept by the worker. `q` searches title, authors and the cards' questions and key idea in English and Bangla |
| GET | `/papers/:id` | Adds `cards` (`en`, `bn`), `links` (`open_url`, `pdf_url`, `code_url`), metadata, and `my_reading` (step and private note) |
| GET | `/papers/:id/learn-first` | `ready` / `total`, `ai_suggested`, and per topic `label`, `why`, `link` (lesson, note, quiz or reel), `known`, `done` |
| GET | `/papers/:id/related`, `/papers/:id/lineage?limit=3` | Related by shared topics; lineage = `builds_on` and `built_on_by` with citation `intent` |
| PUT / DELETE | `/papers/:id/save` | Bookmark |
| PUT | `/papers/:id/reading` | `{ step: 0–3 }` (Explored, Studied, Reproduced); lowering clears the later steps |
| POST | `/papers/:id/mark-read` | Step 1, never lowering a higher step |
| PUT | `/papers/:id/note` | `{ note }`, at most 400 characters, private |
| GET | `/me/papers/up-next`, `/me/papers?list=saved\|read` | Up next = the earliest saved paper not yet read |
| GET | `/me/reading/stats`, `/users/:id/reading` | Explored / studied / reproduced, this month and in total |
| GET / DELETE | `/me/research-outputs`, `/research-outputs/:id` | Saved AI maps and roadmaps, reopened from the stored row |
| GET | `/trails?field=&lang=`, `/trails/:id`, `/users/:id/trails` | Reading paths users made |
| POST · PATCH · DELETE | `/trails`, `/trails/:id` | `{ title, description?, lang, field?, items?, publish? }` |
| PUT | `/trails/:id/items`, `/trails/:id/status` | `{ items: [{ paper_id, note? }] }`; `{ status: draft or published }` (at least 2 papers) |
| PUT / DELETE | `/papers/:id/status` | Prototype 2 tracker (`saved`, `reading`, `completed`), kept as it was |

**Across the app**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications`, `/notifications/unread-count` | |
| POST | `/notifications/:id/read` | |
| GET | `/search?q=&type=&limit=` | Grouped; private posts, drafts and blocked users are never included |
| GET | `/search/suggest?q=` | Autocomplete, at least 2 characters |
| GET | `/app/config` | `{ min_version: { android, ios } }`, no sign-in needed |

**Admin panel (2FA required)**

| Role | Method | Path |
| --- | --- | --- |
| moderator+ | GET | `/admin/reports?status=open` (oldest first, with a target preview) |
| moderator+ | POST | `/admin/reports/:id/resolve { action: dismiss, remove_content or suspend_user }` |
| admin | GET · POST · PATCH | `/admin/papers`, `/admin/courses`, `/admin/learn-items`, `/admin/questions`, `/admin/quizzes` (lists take `?status=`), and `GET /admin/<type>/:id` for the preview |
| admin | PUT · DELETE | `/admin/<type>/:id/status { status: draft, published or archived }`, `/admin/<type>/:id` |
| admin | POST · PATCH · DELETE | `/admin/topics[/:slug]`, `/admin/fields[/:slug]` |
| admin | PUT | `/admin/courses/:id/items { item_ids }`, `/admin/quizzes/:id/questions { question_ids }`, `/admin/papers/:id/prerequisites { topics }` or `{ items: [{ topic, label?, why?, link?, suggested_by? }] }`, `/admin/fields/:slug/roadmap { steps }` |
| admin | POST | `/admin/papers/import { field, arxiv_id or doi }` (draft; the worker fills metadata), `/admin/papers/:id/sync` (queue a refresh) |
| admin | GET · PUT · DELETE | `/admin/papers/:id/cards`, `/admin/papers/:id/cards/:lang` (`en` or `bn`). PUT `{ question?, extra_questions?, problem?, key_idea?, data_source?, method_steps?, findings?, evaluation?, figures?, takeaway?, limitations?, glossary?, source? }`. The paper's summary fields (`research_questions`, `main_idea`, `results`…) in `/admin/papers` read and write the English card |
| admin | PUT · DELETE | `/admin/paper-edges { citing_paper_id, cited_paper_id, intent }`: the only way to mark a citation `contrasting` |
| admin | GET · PUT | `/admin/users?q=`, `/admin/users/:id/status`, `/admin/users/:id/role` |
| admin | GET | `/admin/audit-log` |

**Outside `/v1`**

| Path | What |
| --- | --- |
| `GET /health` | Database check |
| `PUT /storage/raw/:token` | Development stand-in for a presigned S3/R2 upload |
| `GET /media/public/…`, `GET /media/s/:token/…` | Development stand-in for the CDN (public and signed media) |
| `GET /.well-known/assetlinks.json`, `GET /p/:id`, `/papers/:id`, `/courses/:id` | Android App Links and share-link fallback (set `ANDROID_PACKAGE_NAME`) |
