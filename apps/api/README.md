# Doshomik Bytes API (Prototype 2)

The backend: a Fastify API and a background worker on PostgreSQL (30 tables, via Kysely).

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
pnpm worker                       # in a second terminal: media, notifications, email, maintenance
```

The seeded admin must turn on two-factor sign-in before the admin API opens:

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
  worker.ts              Worker process: media loop, outbox loop, hourly maintenance
  config/env.ts          Environment variables, validated with zod
  db/                    Kysely instance, generated types, visibility rules, search expressions, pg error codes
  lib/                   auth hooks, crypto (derived keys, signed tokens), errors, pagination, outbox, audit,
                         rate limits, storage, TOTP, validation
  providers/             Email, push and Google sign-in, each behind an interface with a local stand-in
  modules/<area>/        <area>.routes.ts (HTTP + validation) and <area>.service.ts (queries and rules)
  worker/                media.ts (sharp + ffmpeg), outbox.ts (event handlers), notify.ts, maintenance.ts
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
| GET | `/me/blocks`, `/me/saved`, `/me/courses` | Blocked users, saved posts, courses in progress |
| GET | `/users/suggestions`, `/users/:id`, `/users/:id/posts`, `/users/:id/papers` | Profile has `follow_status`: `none`, `pending` or `accepted` |
| PUT / DELETE | `/users/:id/follow` | Returns `{ status: accepted }`, or `pending` for a private account |
| PUT / DELETE | `/users/:id/block` | Hides both users from each other everywhere, ends follows |
| POST | `/reports` | `{ target_type: user, post or comment; target_id; reason; details? }` |

**Media and social**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/media/uploads`, `/media/:id/complete` | See *Uploading media* |
| GET | `/media/:id` | Your upload's status |
| POST | `/posts` | `{ type, caption?, media_id? }` |
| GET / DELETE | `/posts/:id` | Delete is a soft delete, purged after 30 days |
| GET | `/feed`, `/reels` | Home (accepted follows) and Reels, newest first |
| PUT / DELETE | `/posts/:id/like`, `/posts/:id/save` | |
| GET / POST | `/posts/:id/comments`, `/papers/:id/comments` | `{ body, parent_id? }` |
| GET / DELETE | `/comments/:id/replies`, `/comments/:id` | Deleted comments stay as `is_deleted` placeholders |

**Learn, Practice, Research**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/topics`, `/topics/:slug` | |
| GET | `/learn-items?topic=`, `/learn-items/:id` | |
| GET | `/courses`, `/courses/:id` | With `my_progress` |
| PUT | `/courses/:id/progress` | `{ last_position }`; the last step marks the course completed |
| GET | `/practice/questions?topic=&limit=` | Random; no answers |
| POST | `/practice/questions/:id/answer` | `{ answer }` → `{ correct, correct_answer, explanation }`; recorded |
| GET | `/me/practice/history`, `/me/practice/stats` | Stats give accuracy per topic and `streak_days` |
| GET | `/quizzes?topic=`, `/quizzes/:id` | |
| GET | `/fields`, `/fields/:slug/roadmap` | |
| GET | `/papers?field=&q=&interests=true`, `/papers/:id` | |
| GET | `/papers/:id/learn-first`, `/papers/:id/related` | |
| PUT / DELETE | `/papers/:id/status` | `saved`, `reading` or `completed` |

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
| admin | PUT | `/admin/courses/:id/items { item_ids }`, `/admin/quizzes/:id/questions { question_ids }`, `/admin/papers/:id/prerequisites { topics }`, `/admin/fields/:slug/roadmap { steps }` |
| admin | GET · PUT | `/admin/users?q=`, `/admin/users/:id/status`, `/admin/users/:id/role` |
| admin | GET | `/admin/audit-log` |

**Outside `/v1`**

| Path | What |
| --- | --- |
| `GET /health` | Database check |
| `PUT /storage/raw/:token` | Development stand-in for a presigned S3/R2 upload |
| `GET /media/public/…`, `GET /media/s/:token/…` | Development stand-in for the CDN (public and signed media) |
| `GET /.well-known/assetlinks.json`, `GET /p/:id`, `/papers/:id`, `/courses/:id` | Android App Links and share-link fallback (set `ANDROID_PACKAGE_NAME`) |
