# Prototype 2: implementation notes

Nov 22, 2026

The Prototype 2 backend is built from `docs/Prototype 2 — Features, Database, Security & Efficiency.md`. This file records:

- the decisions made where that doc left a choice open, and why;
- what is **not** built yet, why, and the exact steps to finish each item.

The API reference is in `apps/api/README.md`.

## Contents

1. [What was built](#1-what-was-built)
2. [Decisions](#2-decisions)
3. [Deferred work: install later](#3-deferred-work-install-later)
4. [Deferred work: product and hardening](#4-deferred-work-product-and-hardening)
5. [Known limitations to keep in mind](#5-known-limitations-to-keep-in-mind)
6. [Breaking changes from Prototype 1](#6-breaking-changes-from-prototype-1)

---

## 1. What was built

| Area | Built |
| --- | --- |
| Database | The doc's appendix migration (30 tables) unchanged, plus a backfill migration and one migration of additions (§2.1). Tested on Prototype 1 data, up and down. |
| Security | Access tokens (15 min) and rotating refresh tokens (30 days, sliding) with reuse detection. Sessions per device: list, sign out one. Public UUIDs everywhere. Encrypted cursors. Object-level visibility in one shared layer. Signed upload and media URLs. Request ids in every error. No tokens or emails in logs. HSTS in production. Per-IP and per-user rate limits. Per-account growing delays after failed sign-ins. Argon2id. |
| Account | Email verification, password reset (with "if that email exists"), Google sign-in, account deletion with a 30-day purge, two-factor sign-in (TOTP; required for staff), onboarding interests. |
| Social | Private accounts with follow requests, block, report, saved posts, soft-deleted posts and comments ("[deleted]" placeholders), stored like and comment counters, share URLs. |
| Video and images | Upload slot → direct upload to storage → complete → worker: ffprobe check, 90 s reel limit, HLS ladder (360p–1080p, H.264 + AAC), poster, WebP image variants, metadata (GPS) stripped → ready → post published + "post is live" notification. |
| Learn and Practice | Drafts → published → archived. Course progress, practice history with accuracy and streak, quizzes. |
| Research | Drafts and publishing, related papers, interest filter, roadmaps of published papers only. |
| Admin panel API | CRUD for all team content with drafts, preview, publish and archive. `created_by` and `updated_by` on content, and an audit log of every admin action. Reports queue with resolve actions (dismiss, remove content, suspend). Account status and staff roles. |
| Worker | Separate process (`pnpm worker`) with three loops: media processing, the outbox (counters, notifications, push, email) and hourly maintenance (account purge, deleted-post purge, counter repair, clean-up). |
| Across the app | Search with the new visibility rules, autocomplete, the `/v1/app/config` minimum-version endpoint, Android App Links file and share-link fallback, ETags and compression. |
| Tests | 34 route tests through `fastify.inject`, including the real ffmpeg and sharp pipeline. |

## 2. Decisions

### 2.1 Database

| Decision | Why | Consequence / later |
| --- | --- | --- |
| The appendix SQL is migration `…001` **unchanged**, except its `BEGIN`/`COMMIT` | node-pg-migrate already wraps each migration in a transaction; a `COMMIT` inside it would commit early | None |
| Kept `gen_random_uuid()`, did not switch to `uuidv7()` | `uuidv7()` exists only on PostgreSQL 18; the production version isn't fixed yet, and `gen_random_uuid()` works on 13+ | When production is known to run PG 18, a migration can change the column defaults to `uuidv7()` (better index locality). Existing ids stay valid. |
| Migration `…002` finishes the appendix's "after backfill" steps: slugs `NOT NULL`, post media moved into `media_assets`, `posts.media_url` and `duration_seconds` dropped, `CHECK (type = 'text' OR media_id IS NOT NULL)` | The doc says to do it after the backfill; doing it now means only one source of truth for media | Prototype 1 post media becomes `provider = 'legacy'` assets whose `playback_key` is the old URL, returned unchanged. Prototype 1 never shipped, so no real files are affected. |
| `learn_items_check` now allows `media_url` **or** `media_id` | A learn item can use the new pipeline (`media_id`) or an outside link (`media_url`); the old check required `media_url` | — |
| Migration `…003` adds `sessions.public_id`, `users.totp_secret`, `users.totp_enabled_at` and four indexes | The API needs to name a device session ("sign out of this device"), and tokens carry it, without exposing numeric ids. Two-factor sign-in is required for staff but has no columns in the appendix. | `totp_secret` is AES-256-GCM encrypted with a key derived from `APP_SECRET` |
| ~~Follower counts are still counted with `COUNT(*)`~~ Superseded by migration `…004` (§2.6) | — | — |

### 2.2 Security and auth

| Decision | Why | Consequence / later |
| --- | --- | --- |
| One `APP_SECRET`; separate keys derived with HKDF for JWTs, cursors, upload links, media links, MFA tokens and TOTP secrets | One secret to manage; a leaked key for one purpose can't forge another | Rotating `APP_SECRET` signs everyone out and breaks media links: plan it as a migration |
| Refresh token = `<session public id>.<secret>`; only the secret's hash is stored; rotation is a compare-and-swap | Lets the server spot reuse of an old token and revoke that session, as the doc requires | Two refreshes racing with the same token (a flaky retry) revoke the session; the app should serialize refreshes |
| Each request checks that its session is live and the account is active (one indexed query) | Signing out a device, suspension and deletion take effect at once, not after 15 minutes | One extra query per request; cache it in Redis when Redis is installed |
| Access tokens carry public ids only (`sub` = user, `sid` = session) | A decoded token must not reveal row counts | — |
| Pagination cursors are encrypted | They contain the internal id tie-breaker | — |
| Google sign-in uses `jose` against Google's public keys and checks issuer, audience and expiry | Same checks as Google's library with less code | Set `GOOGLE_CLIENT_IDS` (Android, iOS and web client ids) |
| A verified Google email is linked to an existing account with the same email | Google is authoritative for its verified emails; avoids duplicate accounts | Common practice; revisit if other providers are added |
| Google-only accounts get a username from the email's local part (plus digits if taken) | The doc has no username step for Google sign-up | No "change username" feature exists yet |
| Two-factor sign-in is TOTP (authenticator apps), written in-house (RFC 6238, about 60 lines) | Required for admins and moderators; TOTP needs no paid service | No recovery codes and no replay guard yet (§4) |
| Staff routes require role **and** two-factor sign-in; without it they return `403 MFA_REQUIRED` | The doc: "Admins and moderators must use two-factor authentication" | The seeded admin must call `POST /v1/me/2fa/setup` and `/enable` once |
| Failed-sign-in delays are kept per account in memory | No Redis yet | Per process, reset on restart (§3.1) |
| Login always runs argon2, against a dummy hash when there is no account | Response time doesn't reveal which accounts exist | — |
| Password reset revokes every session | A reset usually means the account may be compromised | — |
| Deleted accounts can't sign in or be restored during the grace period | The doc doesn't ask for restore; it adds a user-facing state to design | Add "cancel deletion" if wanted (§4) |
| Errors carry `request_id`; the `x-request-id` header is always set; client-sent request ids are ignored | Support can match a user's error to the logs; clients can't spoof log ids | — |
| Logs redact the tokens in `/storage/raw/<token>` and `/media/s/<token>/…`; no emails or bodies are logged | "Logs never contain passwords, tokens or full email addresses" | Keep the redaction when adding routes with tokens in the path |

### 2.3 Media

| Decision | Why | Consequence / later |
| --- | --- | --- |
| **Self-hosted pipeline** (FFmpeg worker + local disk), behind a `Storage` interface | Runs locally with no accounts; the doc keeps `media_assets` provider-neutral so a managed service can replace it later | §3.3 covers moving to S3/R2 + CDN, or to Mux, Cloudflare or Bunny |
| Local storage has a `raw/` area (private) and `processed/` (`public/…` unsigned, `posts/…` signed only) | Matches the doc's private raw bucket and CDN-served processed files | — |
| The API process serves `PUT /storage/raw/:token` and `GET /media/…` in development | Stands in for S3 presigned PUTs and the CDN. Bytes still never go through the API routes themselves | In production these routes are replaced by the real bucket and CDN URLs |
| A media asset's `processing` status is the worker's queue; there is no extra outbox event for "uploaded" | Simpler, no duplicate state; the worker polls `media_assets` | — |
| Post media URLs are signed: about 24–48 h for public accounts (cacheable), 1–2 h for private ones | The doc: private content uses signed URLs that expire within hours. One signature covers an asset's folder, so HLS segments resolve too | When an account turns private, links already handed out keep working until they expire |
| Avatars, learn media and paper figures are public, unsigned and `immutable` | They are public content; stable URLs can be stored in `users.avatar_url` and `papers.figures` | Keys contain unguessable UUIDs |
| An upload with purpose `avatar` becomes the avatar once processed; older avatar files are deleted | Saves an extra call. The doc has no avatar media column | — |
| Ladder by the short side: 360/540/720/1080, never upscaled; smaller sources keep their size | Portrait reels and landscape videos both fit | 1080p is only made from 1080p sources |
| The raw original is deleted after processing, success or failure | It holds GPS and camera metadata; nothing needs it afterwards | Re-encoding later means re-uploading |
| A failed asset is final; the app uploads again | Transient worker crashes also mark it failed instead of retrying forever | Add bounded retries if crashes turn out to be common |
| Learn videos are capped at 20 minutes (`LEARN_VIDEO_MAX_SECONDS`); reels at 90 s | The doc says learn videos run 3–4 minutes; 20 minutes leaves room | Constants live in `packages/shared` |
| Resumable or multipart uploads are not built | The local stand-in takes one PUT. S3/R2 give resumable multipart uploads natively | Comes with §3.3 |

### 2.4 Worker and outbox

| Decision | Why | Consequence / later |
| --- | --- | --- |
| **No Redis.** The worker reads `outbox_events` and `media_assets` from Postgres | The doc's design needs no Redis for this; Redis isn't installed | §3.1 |
| **One worker process**, enforced with a Postgres advisory lock | No double processing without lease columns | Scaling out needs leases (§3.2) |
| Each event's database work and its "processed" mark commit together; push and email run after commit, best effort | Counters and notifications are exactly once; side effects never roll back data | A failed push or email is logged, not retried |
| ~~Counters are recounted, not incremented~~ Superseded by migration `…004`: counters move by ±1, exactly once per event (§2.6) | — | Counts are still a few seconds behind the action, so the app shows optimistic counts |
| Notifications moved from the request to the worker (`follow`, `follow_request`, `like`, `comment`, `reply`, `post_ready`) | The doc: workers update notifications and push | They appear within about a second, once the worker runs |
| `search.sync` events are written for searchable changes (users, posts, topics, learn items, courses, papers), with no consumer yet | The outbox should already record what the Elasticsearch indexer will need | The worker marks them processed and maintenance deletes them after 30 days. The indexer starts with a full rebuild anyway (§3.4) |
| Events failing 10 times stay unprocessed for inspection | Dead-letter without an extra table | Add an alert on `attempts >= 10` (§4) |
| Hourly maintenance: purge accounts deleted over 30 days ago, purge posts soft-deleted over 30 days ago, repair counters, delete abandoned uploads, old sessions, used codes and processed events over 30 days old | The doc's purge job and nightly repair | Each job is safe to repeat |
| Purge keeps the user's comments as empty `[deleted]` rows | The thread survives (the doc's goal) and the text is gone (privacy) | — |
| Development email goes to files in `DEV_MAIL_DIR`; SMTP when `SMTP_URL` is set (works with the Hostinger mailbox) | Real sending needs only a URL | — |
| Push uses a logging stand-in | FCM needs a Firebase project and service account | §3.5 |

### 2.6 Efficiency pass (migration `…004`, 23 Nov 2026)

Review of every table for rows that are deleted and recreated, and for work repeated on every read or event.

| Decision | Why | Consequence / later |
| --- | --- | --- |
| **Likes are toggle rows.** `post_likes.is_active` (+ `updated_at`). Unlike sets it false; like upserts and reactivates the row | Delete + insert made every like → unlike → like send a new notification and push. With one row per user and post, the API can tell a first like from a re-like (`xmax = 0` on the upsert) | Only the first like ever notifies. Like and unlike write an event only when the state really changes. Inactive rows stay until the user or post is purged |
| `is_active` and `updated_at` are in **no index**; `post_likes (post_id)` is unchanged | A toggle is then a HOT update with no index writes, where delete + insert wrote two index entries. The full `(post_id)` index still serves the post cascade and the repair job | Counting active likes reads the heap, but only the hourly repair job counts likes now |
| **Follows are toggle rows.** A third status `inactive` (unfollowed, withdrawn, declined, or ended by a block) plus `follows.updated_at` | Same re-notification problem as likes. A status value instead of a boolean keeps every `status = 'accepted'` privacy check correct with no change | Only the first follow ever notifies, requests included: a request re-sent after a decline shows in the requests list (ordered by `updated_at`) without a new alert. The API reports `inactive` as `none`. Block ends follows as `inactive` too, so block → unblock → follow can't re-notify |
| **Counters move by ±1** instead of being recounted | A recount read every like and every comment of the post on each event: O(n) on a busy post | Exactly once is guaranteed by the worker **claiming** each event (`UPDATE … SET processed_at … WHERE processed_at IS NULL`) in the same transaction as its work, so even a second worker can't double-apply. Moderation emits `comment.deleted` only for a live comment. The hourly repair job still fixes drift from paths with no event (account purges) |
| **Stored `users.follower_count` and `following_count`**, moved by a new `follow.changed` event (`delta` ±1) | The Prototype 2 doc asks for stored follower counts. Profiles ran two `COUNT(*)`; "people to follow" counted followers for every active user before sorting | `users_suggest_idx (follower_count DESC, id DESC) WHERE status = 'active'` serves suggestions in index order. Counts are seconds behind, like post counters. Every path that starts or ends an accepted follow emits the event: follow, accept, going public, unfollow, block |
| Saving interests writes only the difference | `setInterests` deleted and re-inserted every `user_fields` row on each save | — |
| `notifications_unread_idx (user_id) WHERE NOT is_read` | The unread badge runs on every app open and scanned all of a user's notifications | The query is written as the literal `NOT n.is_read` so it matches the index predicate |
| Dropped the Prototype 1 index `posts (created_at DESC) WHERE type = 'reel'` | `posts_reels_idx` covers the same order with the filters the reels query uses; the old one was only a write cost | — |
| **Not** turned into toggle rows: `saved_posts`, ~~`blocks`~~ (superseded by migration `…006`, §2.9); `user_papers` and `course_progress` already upsert | Re-creating them has no side effects, so a toggle would only add a filter to every read. A re-save must move the post to the top of the list, which rewrites the indexed `created_at` anyway | Revisit if saving gains a side effect (e.g. "X saved your post") |
| Verified on a throwaway cluster | The local database rejects the `.env` credentials, so migrations `…004`–`…005` were run on a temporary PostgreSQL 18 cluster (`E:\PostgreSQL\bin`, port 55432, scratch directory) | Up, down and up again pass; all tests pass; `src/db/types.ts` is the real `kysely-codegen` output. Still run `db:migrate` on the dev database once its password is fixed |

### 2.7 Research tab, Group A (migration `…005`, 23 Nov 2026)

What was checked against the Group A spec (A1–A7, A9, A10, A13), and what was added. Everything is additive: the Prototype 2 research tables, columns and endpoints stay as they were.

| Feature | Already there | Added |
| --- | --- | --- |
| A1 collection, chips, trend order | Papers in a field; newest-first list | Scholarly metadata on `papers`, `fields.position` (chip order), the ingestion worker, `trend_rank` and `?sort=trend` (default) |
| A2 search | English full text on title + main idea | `paper_cards` (EN and BN), `papers.search_vector` over title, authors and both card questions, a `bangla` search configuration |
| A3 save, Up next | `saved` was a tracker status | `paper_saves`; `GET /me/papers/up-next` |
| A4 three steps, private note | saved / reading / completed | `reading_passes` (step 0–3, per-step times, 400-character note); monthly counts |
| A5 My papers | — | `GET /me/papers?list=saved\|read`; `research_outputs` and its read endpoints |
| A6 lineage | "Related" by shared topics | `paper_edges` with intent, filled from Semantic Scholar and OpenAlex; `GET /papers/:id/lineage` |
| A7 reading paths | Staff roadmap, one per field | `trails`, `trail_items`; reports and moderation cover them |
| A9 discussion | **Complete**: `comments.paper_id`, reports, blocks, rate limits, cursors, moderation queue | Nothing |
| A10 open the original | `paper_url` | `pdf_url`, `arxiv_id`; `links.open_url` on the paper |
| A13 Learn before reading | Prerequisite topics with their learn items | Label, why, typed link, AI-suggested flag on `paper_prerequisites`; `user_known_topics`; `learn_item_completions`; `posts.topic_id`; computed `done`, `ready`/`total` |

| Decision | Why | Consequence / later |
| --- | --- | --- |
| **Ingestion runs only in the worker** (`src/worker/papers.ts`, sources in `src/providers/scholarly.ts`) | The spec's hard rule: the app never calls a scholarly API | A `papers` loop syncs up to 10 due papers a minute (new, queued, or older than 7 days), reads Hugging Face daily papers every 6 hours, then re-ranks. `PAPER_SYNC_ENABLED=false` turns it off; maintenance still re-ranks hourly |
| Staff edits win over sources | A curated collection: the team's title or venue must not be overwritten | Descriptive fields are filled only when empty; citation count, TLDR and ids are refreshed every time. An import starts with an empty title, which the first sync fills |
| Papers are added by `POST /admin/papers/import { arxiv_id or doi }` as drafts | Curation stays with the team; no network call in the request | Auto-discovering new papers from Hugging Face into a review queue is deferred (§4) |
| **Semantic Scholar has no "supporting" or "contrasting" intent** | Its labels are `background`, `methodology` and `result` (checked against the live API). The spec's three values can't be filled from it without guessing | We store S2's labels in `s2_intents` and map without inference: methodology → supporting, background → background, result alone → unknown (`NULL`). **Contrasting is set only by staff** (`PUT /admin/paper-edges`); the worker never overwrites a staff edge's intent |
| Edges only between papers in our collection | Every lineage row must be tappable | Built from each paper's own references (S2, then OpenAlex `referenced_works`), so every pair in the collection is found without fetching citation lists. Notable citing papers outside the collection are not shown |
| Trend rank: Hugging Face trending (last 14 days, by upvotes) first, then citations, then newest | The spec takes trend from HF, but classics are never on HF daily papers and still need an order | One dense rank 1..n, stored, so the list is a cheap keyset page (`fetchRankedPage`) on `papers_trend_idx` (since `…006`: `paper_metrics_trend_idx`, §2.9) |
| "New" = published within 30 days (`PAPER_NEW_DAYS`) | A derived flag needs no clean-up job | Uses `published_on` from OpenAlex, or staff |
| One field per paper | The demo filters by a single `paper.topic`; fields already are the chips | Multi-chip membership waits until a paper really needs two chips |
| ~~`paper_cards` per language; the Prototype 2 summary columns stay on `papers`~~ Superseded by migration `…006` (§2.9): the summary now lives only in the English card | The spec searches `question.en` and `question.bn`; existing columns must stay | The English card was backfilled from those columns. New content goes into cards; the old columns are left as they are |
| Search document is a stored `tsvector` maintained by the SQL function `refresh_paper_search` | It combines two tables (paper and cards), which an expression index can't | Called in the same transaction as every paper or card change, and after each sync. The old title + main idea expression index was dropped |
| **`bangla` = PostgreSQL's `simple` configuration** | PostgreSQL ships no Bangla stemmer | Lower-casing only, no stemming. How Bangla words split depends on the server's locale; with a C locale every Bangla letter and sign is kept in the word. Swap in a real Bangla dictionary later without changing queries |
| Separate `paper_saves` and `reading_passes`; `user_papers` kept unchanged | Save and reading progress are independent in the spec; the old tracker endpoints stay | Both new tables were backfilled from `user_papers` (all saved; reading → Explored, completed → Studied). Writes to the old endpoints don't reach the new tables: the app should use the new ones, and `user_papers` can be dropped once no client calls `/papers/:id/status` |
| Lowering a step clears the later step times | "14 explored this month" must not count steps the user took back | CHECK constraints keep step and times consistent |
| Concepts are our `topics` | `topics` already link learn items, questions, quizzes and prerequisites | `user_known_topics` is the spec's `user_known_concepts`; reels get `posts.topic_id` |
| Prerequisite links are three nullable FKs (learn item, quiz, reel), at most one set | Typed links with real foreign keys instead of a polymorphic id | Lesson vs note is the learn item's kind (video vs text/image). A deleted target sets the link to NULL |
| Done is computed, never stored | The spec | Lesson or note: in `learn_item_completions` (course progress also writes it). Quiz: every published question has an attempt. Or "I already know this" |
| `research_outputs` holds Group C results; only read, list and delete exist | Group C tools aren't specified yet | Reopening reads the row: no AI, no allowance |
| Trails: any user can make one; publishing needs at least 2 papers; visibility follows the author like posts | Gives creators something to make; a one-paper path isn't a path | Reports and the moderation queue cover trails (`remove_content` sets `removed`) |
| A9 comment upvotes not built | The spec puts them with Paper Clubs (A15) | Add with A15 |

### 2.8 Auth switched off during development (24 Nov 2026)

The owner's call: sign-in, permissions and password flows are tested **last**, so building and testing the mobile app and admin panel isn't slowed by tokens and two-factor codes. The auth code stays built and tested; it is bypassed, not removed.

| Decision | Why | Consequence / later |
| --- | --- | --- |
| `DEV_AUTH_BYPASS=true` makes a token-less request act as `DEV_AUTH_USER` (default `admin`) or the `x-dev-user` username, counted as two-factor signed in (`lib/auth.ts`) | One switch on the server instead of auth-free code paths in every route; staff checks, visibility rules and rate limits still run as that user | Clients can skip the sign-in screens and token refresh until the end |
| A request **with** a token still uses real auth | Sign-in flows stay testable at any time | — |
| One long-lived session per dev user (`sessions.app_version = 'dev-bypass'`, platform `web`) | Routes that need a session (sign out, push token, device list) keep working | These rows show up in the device list; the hourly clean-up removes them a year after creation, or when revoked |
| The API refuses to start with the bypass on in production (`config/env.ts`) | A forgotten flag must not ship | — |
| The seed adds `learner1` and `learner2` (password `devpassword`) outside production | Social flows need two ordinary accounts | — |
| Off in tests by default; `test/auth.test.ts` covers it switched on | The existing tests keep testing real auth | — |

**Turning auth back on (end of development):** set `DEV_AUTH_BYPASS=false`; build the mobile sign-up, sign-in, refresh (one at a time, §2.2), password reset, email verification and Google screens, and the admin panel's sign-in plus 2FA setup; run the `security-review` pass; then delete the bypass (`devAuthContext` in `lib/auth.ts`, the two env vars, the test block and the seeded dev users) before the first release build.

### 2.9 Database refactoring (migration `…006`, 26 Nov 2026)

The owner asked for four schema changes after reviewing the 39-table schema. The full write-up, with before/after tables and the column mapping, is [`docs/database-refactoring-report.md`](database-refactoring-report.md). The Prototype v1 and Prototype 2 docs are unchanged; where their schema sections differ, this section and the migrations are what the code follows.

| Decision | Why | Consequence / later |
| --- | --- | --- |
| `blocks` is a toggle row: `is_active` and `updated_at`; unblock sets `is_active = false`, a reblock reactivates the same row | The owner's spec, and the same pattern as likes and follows (§2.6) | `created_at` is the first block ever; `/me/blocks` lists active blocks by `updated_at` (when the current block began). Neither column is indexed, so a toggle is a HOT update. The only readers are `notBlocked()` and the notification check, both now filter `is_active` |
| `papers` split into `paper_metadata` (ids, TLDR, OpenAlex topics), `paper_metrics` (counts, rank) and `paper_sync` (queue), each with `paper_id` as PK and FK, cascade | One writer and schedule per table: staff edit `papers`, the worker writes the other three. Columns, types, checks and uniques moved unchanged | **The API creates the three rows with every paper** (`createPaperCompanions`, in the same transaction, also used by the seed). Reads use inner joins, so a paper inserted without them would disappear from lists and the queue: any new insert path must call it. No trigger, to match the rest of the codebase (search refresh is also explicit) |
| `papers_trend_idx` becomes `paper_metrics_trend_idx ((coalesce(trend_rank, 2147483647)), paper_id)` without `WHERE status = 'published'` | A partial index can't reference another table's column | `rankPapers` already clears ranks of unpublished papers; the list query joins `papers` for status and keysets on `pm.paper_id`, so the index is read in order (checked with `EXPLAIN`) |
| `papers_sync_idx` becomes `paper_sync_due_idx (synced_at NULLS FIRST, paper_id)`; the "has a DOI or arXiv id" predicate moved into the query | The identifiers now live in `paper_metadata` | Papers with no identifier also sit at the head of the index (never synced), and each round skips them through a primary-key lookup. Fine for a curated collection of thousands; if it grows to many id-less papers, give them a non-NULL `synced_at` or a partial index on a flag |
| The summary columns moved into the **English** `paper_cards` row; new card columns `extra_questions text[]`, `data_source`, `evaluation`, `figures jsonb` | The owner's spec: cards are the single source of truth. These four had no card equivalent; `research_questions[1]` stays the headline `question`, the rest become `extra_questions` | Mapping: main_idea → key_idea, results → findings, method_steps and limitations by name. Bangla cards untouched |
| Conflict rule in the migration: a card someone edited (`updated_by` set, or `source = 'ai'`) wins over the summary; a card nobody edited (005's copy) loses to the summary, which kept being edited through `PATCH /admin/papers` after 005; empty fields are always filled | "Manually edited cards take precedence", without discarding newer summary edits | The losing text of every real conflict is written to `audit_log` (`action = 'paper.summary_migration'`, `actor_id` NULL, `changes = {kept, replaced}`), so nothing is lost. Review those rows after migrating a real database |
| The API keeps its Prototype 2 summary keys (`research_questions`, `main_idea`, `data_source`, `method_steps`, `results`, `figures`, `limitations`, `evaluation`) in `GET /papers/:id` and the admin paper endpoints | The owner asked to preserve contracts | They read and write the English card (`summaryFromEnglishCard`, `splitPaperBody` in the admin routes). A PATCH writes only the fields sent. Cards and their responses gain the four new fields |
| `refresh_paper_search()` reads question, extra questions and key idea of both cards; title and authors from `papers` | `main_idea` is gone; Bangla gets the same fields as English | The migration rebuilds every document. Callers are unchanged: every paper or card change and every sync call it |
| Report targets are validated per type before filing (no FK on purpose) | The owner's spec | User: active, not yourself (`400 SELF_REPORT`). Post and trail: visible to the reporter. Comment: live, in a thread the reporter can see, author not blocked either way. Otherwise `404`. A blocked user can still be reported |
| Verified on a throwaway cluster | The dev database still rejects the `.env` password | Up, down, up on a database with pre-`…006` data; a migration test (`test/migration.test.ts`) does the same on its own database; all tests pass; `src/db/types.ts` is real `kysely-codegen` output. **Run `db:migrate` on the dev database once its password is fixed**, then check `audit_log` for `paper.summary_migration` rows |

### 2.5 API shape

| Decision | Why |
| --- | --- |
| Everything under `/v1` | The doc: old app versions stay installed for months |
| `id` in every response is the public UUID. Topics and fields are named by `slug` (`/v1/topics/attention-mechanism`) | The doc's public ids and slugs |
| Visibility rules live in `src/db/visibility.ts` and every query uses them | The doc: one shared query layer for private accounts, blocks, drafts and deleted items |
| Another user's private upload, notification or session returns 404, not 403 | Doesn't confirm it exists |
| Course steps are renumbered 1..n over the **published** items | Drafts in a course don't leave gaps |
| `GET /v1/papers/:id/related` ranks by shared Learn first topics, then same field | A useful "Papers like this one" without Elasticsearch; replaced by semantic similarity later |
| Request validation only (zod); responses are not schema-checked | Selects name their columns explicitly, so no hidden fields leak. Response schemas come with the OpenAPI spec (§4) |
| Text in push messages and emails is English | User language isn't stored yet (§4) |

## 3. Deferred work: install later

### 3.1 Redis

**Why it is deferred:** it isn't installed, and nothing in this round strictly needs it.

**What waits on it:**

- rate-limit counters shared across processes (they are in memory now);
- the per-account sign-in delays (`LoginThrottle`, in memory now);
- the doc's caches: the first feed page (60 s), hot profiles, paper and course pages, topic lists;
- the ranked reels list;
- optionally, the per-request session lookup cache.

**Steps:**

1. Install Memurai Developer (Windows) or Redis in WSL2 locally; on the VPS, use the Redis container from `stack-v1.txt`.
2. Add `REDIS_URL` to `src/config/env.ts` and `pnpm add ioredis`.
3. In `src/app.ts`, pass `redis: new Redis(env.REDIS_URL)` to `@fastify/rate-limit`. Routes keep using `lib/rate-limits.ts` unchanged.
4. Re-implement `LoginThrottle` with `INCR` and `PEXPIRE` on keys `login:<name>`, keeping the same class API.
5. Cache the first feed page per user for 60 s (key `feed:<userId>`). Delete the key in the `follow.created` and post-publish handlers.
6. Reels ranking: a maintenance job scores recent reels (recency, `like_count`, and watch completion once it exists) into a sorted set `reels:ranked`; `listReels` reads ids from it, falling back to newest-first.

### 3.2 Several workers (leases)

**Why it is deferred:** one worker is enough at this scale, and the advisory lock in `src/worker.ts` keeps it safe.

**Steps:**

1. Add a migration with `locked_until timestamptz` on `outbox_events` and `media_assets`.
2. Claim rows with `UPDATE … SET locked_until = now() + interval '5 minutes' WHERE id = (SELECT id … WHERE processed_at IS NULL AND (locked_until IS NULL OR locked_until < now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
3. Remove the advisory lock.

### 3.3 Object storage, CDN and a video provider

**Why it is deferred:** they need accounts and keys. Local disk stands in behind `Storage`.

**Steps for S3/R2 + CDN (self-hosted encoding):**

1. Write `S3Storage implements Storage` in `src/lib/storage.ts`:
   - `createUploadUrl`: a presigned PUT with content-type and content-length conditions, or a presigned multipart upload for resumable uploads;
   - `rawSize`: `HeadObject`;
   - `openRaw`: download to a temp file, deleted in `release()`;
   - `putProcessed`: upload the folder;
   - `publicUrl` and `signedUrl`: CDN URLs. For HLS, use CloudFront signed cookies or a signed path prefix, like the local `/media/s/<token>/` scheme.
2. Choose the implementation from env (`STORAGE_DRIVER=s3`). Stop registering `storageRoutes` when it isn't local.
3. Data moves by copying `media/processed/` to the bucket; keys are unchanged.

**Steps for a managed video service (Mux, Cloudflare Stream, Bunny):**

1. Set `media_assets.provider` and `provider_asset_id`.
2. Replace `processVideo` with "create the asset at the provider", and take readiness from its webhook.
3. Write the `media.ready` outbox event exactly as the worker does now; everything downstream stays the same.

### 3.4 Elasticsearch (or OpenSearch)

**Why it is deferred:** it isn't installed, and semantic search needs an embedding model (Elastic's `semantic_text` needs ML features, a trial or paid licence, or an external embedding API). Search runs on Postgres meanwhile, as the doc's fallback.

**Steps:**

1. Run Elasticsearch 8 locally (Windows zip, no Docker) or on Elastic Cloud. Add `ELASTICSEARCH_URL` to env and `pnpm add @elastic/elasticsearch`.
2. Create one index per type (users, posts, topics, learn, courses, papers), each behind an alias. Add search-as-you-type fields for names and titles, and a synonym list for topics ("LLM" → "large language model").
3. Indexer: add a handler for `search.sync` in `src/worker/outbox.ts`. Load the entity, then index it or delete it when it's no longer visible (deleted, draft, private, inactive). Start with a full rebuild script that indexes everything and swaps the alias.
4. Semantic part: give `learn`, `courses` and `papers` a `semantic_text` field built from title, summary, main idea and research questions, and merge keyword and semantic hits with RRF.
5. Search service: query Elasticsearch, filter by the viewer's blocks (pass their blocked ids), and fall back to the current Postgres searchers on error, as the doc requires.
6. `GET /v1/papers/:id/related`: switch to a semantic kNN query; keep the topic-overlap version as the fallback.
7. Nightly job: compare per-type counts between Postgres and the index, and reindex any drift.

### 3.5 Push notifications (Firebase Cloud Messaging)

**Why it is deferred:** it needs a Firebase project and a service-account key. Push tokens are already stored per session (`PUT /v1/sessions/current/push-token`), and messages already go through `providers.push`.

**Steps:**

1. `pnpm add firebase-admin`. Add `FCM_SERVICE_ACCOUNT_JSON` to the secrets.
2. Write `FcmPush implements PushSender` in `src/providers/index.ts` using `sendEachForMulticast`.
3. Clear `sessions.push_token` for tokens FCM reports as unregistered.

### 3.6 Google sign-in keys

The code is done. Create OAuth client ids (Android with the app's SHA-1, iOS later, web for the admin panel) in Google Cloud, and put them in `GOOGLE_CLIENT_IDS`.

## 4. Deferred work: product and hardening

| Item | Why deferred | How to finish |
| --- | --- | --- |
| Web page for deletion requests (Google Play requires a link) | It is a web UI; the API already supports it: sign in, then `DELETE /v1/me` | A small page in the admin web app (or a static page) that signs in and calls `DELETE /v1/me` |
| Restore an account during the grace period | Not asked for; needs UX | Allow login for `status = 'deleted'` within the grace period with a `restore: true` flag that clears `deleted_at` |
| Sign in with Apple (iOS) | iOS comes later | `auth_identities.provider` already allows `apple`; add an `AppleIdTokens` verifier (JWKS at `appleid.apple.com/auth/keys`) and `POST /v1/auth/apple` |
| 2FA recovery codes and replay guard | Keeps this round small | Store hashed recovery codes; remember the last used TOTP step per user to reject reuse |
| Play Integrity / App Attest | Needs a Google Cloud project; doc phase 8 | Verify the integrity token on sign-up and posting; reject or rate-limit failures |
| OpenAPI spec for the iOS team | Doc: "Describe the API in an OpenAPI spec" | Add `@fastify/swagger` with `jsonSchemaTransform` (the zod schemas already describe every request), plus response schemas |
| Monitoring: metrics, tracing, crash reporting, alerts | Infra, not local | OpenTelemetry for Fastify and pg; alert on 5xx rate, p95 latency, outbox backlog (`processed_at IS NULL`) and dead events (`attempts >= 10`) |
| PgBouncer, separate DB users, backups with point-in-time recovery, secrets manager | Deployment work (doc phase 1 / production) | App DB user with DML only and a migration user with DDL (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES …`); run migrations with the migration user; secrets in the VPS secret store, not `.env` |
| Watch-time and view analytics | Doc: send to an analytics store, not Postgres | Batch playback events from the app to an analytics service; feed reels ranking (§3.1) |
| Notification and email text in Bangla | User language isn't stored | Add `users.locale`; pick templates by it, or send data-only pushes and let the app render the text |
| Read replica, partitioning `notifications` and `question_attempts` | Only at millions of rows | As in the doc's efficiency table |
| Feed precomputed timelines | Only once the feed's p95 latency passes about 100 ms | As in the doc |
| Automated nudity and violence screening | Doc: "Later" | A worker step before `media.ready` |
| Change username | Not in the doc | `PATCH /v1/me { username }` with the same lowercase and unique rules |
| Paper discovery queue | Group A curates by hand (`/admin/papers/import`) | A `paper_candidates` table filled from Hugging Face daily papers above an upvote threshold, reviewed in the admin panel |
| Comment upvotes on papers (A9 → A15) | Belongs to Paper Clubs | `comment_votes (user_id, comment_id)` plus a stored `comments.upvote_count` moved by outbox events, and `?sort=top` |
| A real Bangla text search dictionary | PostgreSQL has none built in | Replace the `bangla` configuration's mapping with a Hunspell or custom dictionary; queries stay the same |
| Group B (cards and prerequisites suggested by AI) and Group C (maps, roadmaps, comparisons, claim checks) | Not specified yet | They write `paper_cards` (`source = 'ai'`), `paper_prerequisites` (`suggested_by = 'ai'`) and `research_outputs` |

## 5. Known limitations to keep in mind

- **One API process and one worker process.** Rate limits and sign-in delays are in memory, so they aren't shared across API processes. The advisory lock refuses a second worker.
- **Counts lag by about a second** (outbox). The app should update like and comment counts optimistically.
- **Prototype 1 uploads.** Post media is kept as `legacy` assets with their old URLs, but the Prototype 1 `/media/posts/...` and `/media/avatars/...` routes no longer exist. Prototype 1 never shipped, so only local test files are affected.
- **`apps/api/.env` was regenerated** for the new variables (`APP_SECRET`, `PUBLIC_URL`). Set `SEED_ADMIN_PASSWORD` again if you had changed it.
- **Unverified email doesn't block anything yet.** `email_verified` is exposed so the app can prompt for it. Gating posting on verification is one `where` clause if wanted.

## 6. Breaking changes from Prototype 1

There are no clients yet, so the API changed in place:

- All routes moved under `/v1`.
- Ids are UUIDs; topics and fields use slugs.
- Sign-in returns `access_token` and `refresh_token`, and needs `platform`.
- Posts take a `media_id` from the upload flow instead of a multipart file.
- `/admin/media` is replaced by `POST /v1/media/uploads` with purpose `learn` or `paper_figure`.
- Admin content is created as a draft and must be published.
