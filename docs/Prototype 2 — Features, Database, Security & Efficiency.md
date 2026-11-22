# Prototype 2 — Features, Database, Security & Efficiency

Nov 22, 2026 · @Doshomik

## Summary

Prototype 2 keeps every Prototype 1 table and adds what production needs: a proper video pipeline, Elasticsearch with semantic search, real authentication, soft deletes, and background workers so slow work never runs inside a user's request. Nothing in Prototype 1 has to be thrown away; every change is an added column, an added table, or a changed constraint.

The four priorities, in order:

1. **Security.** Token-based auth with refresh rotation, public IDs that can't be guessed, object-level permission checks, signed media URLs, account deletion (both app stores require it), and moderation.
2. **Video.** Uploads go straight to storage, get transcoded to adaptive streaming (HLS) by a worker, and play from a CDN.
3. **Search.** Postgres stays the source of truth. Elasticsearch handles fast keyword search with typo tolerance, plus semantic search for learning content and papers, merged into one ranked list.
4. **Efficiency.** Cursor pagination, a Redis cache, stored counters, an event outbox, and connection pooling.

**Stack note.** This plan assumes PostgreSQL, an Android app first with iOS to follow, and Elasticsearch, as you asked. I couldn't see the client's initial plan with its stack choices: only the feature description is attached to this chat. Where a choice depends on the stack (backend language, cloud provider, video service), this doc names the role and gives a default, so it can be swapped for the client's pick.

## Architecture

The API answers requests and nothing else. Uploads go straight to storage, media plays from a CDN, and workers do the slow jobs.

&#91;embedded content: Prototype 2 architecture · 11 components\]

Every change the API makes writes an outbox event in the same database transaction. Workers pick events up and update Elasticsearch, counters, notifications and push, so none of that slows the user's request, and nothing is lost if a worker is down for a while.

## Feature updates

Prototype 2 adds 16 features. Five are required before a public release; the rest make the app feel finished.

| Area | Feature | What changes for the user | Required for release? |
| --- | --- | --- | --- |
| Account | Delete account | Delete account in Settings, plus a web page for the same request | Yes: Google Play and the App Store both require it |
| Account | Google sign-in, email verification, password reset | Faster sign-up; verified emails; account recovery | Yes |
| Account | Sessions on each device | See signed-in devices and sign out of any of them | No |
| Account | Onboarding interests | Pick fields and topics at sign-up to seed Home, Learn and Research | No |
| Social | Block and report | Block a user; report a post, comment or user | Yes: needed for any app with user content |
| Social | Private accounts and follow requests | Only approved followers see your posts | No |
| Social | Saved posts | Bookmark posts and reels | No |
| Social | Share and deep links | Share a post, paper or course as a link that opens the app | No |
| Social | Upload progress and processing state | Reels show uploading, processing, then live | Yes: needed once transcoding exists |
| Learn | Course progress | Resume a course where you left it | No |
| Practice | Practice history | Past answers, accuracy per topic, simple streak | No |
| Practice | Quizzes | Named sets of questions in a fixed order | No |
| Research | Related papers and semantic search | "Papers like this one"; search by meaning, not exact words | No |
| Across the app | Push notifications | Notifications arrive when the app is closed | No |
| Across the app | Search suggestions | Autocomplete and typo tolerance while typing | No |
| Team | Admin web panel | Team writes papers, courses and questions as drafts, previews, then publishes; reviews reports | Yes: the team can't manage 50+ papers by editing the database |

The Prototype 1 flows stay the same. The new flows are short: Settings → Delete account → confirm → signed out, data removed after a grace period; and Create reel → upload with progress → "processing" badge → notification when it is live.

## Video: upload, processing, playback

Video bytes never pass through the API server. The app uploads straight to storage, a worker converts the file to adaptive streaming (HLS), and the app plays it from a CDN. This keeps the API fast and lets playback adjust to the user's connection.

**Upload and processing**

1. The app asks the API for an upload slot, sending file type and size. The API checks limits, creates a `media_assets` row with status `uploading`, and returns a short-lived signed upload URL (about 15 minutes).
2. The app uploads directly to a private "raw" bucket with a resumable or multipart upload, so a dropped mobile connection resumes instead of restarting. Optionally, compress on the phone first (Android Media3 Transformer) to cut upload size.
3. The app tells the API the upload is done. The API confirms the file exists and matches the declared size, sets status `processing`, and queues a job.
4. A worker inspects the real file with ffprobe. It rejects a reel over 90 seconds or a file that isn't really video, whatever the app claimed, and strips metadata such as GPS location.
5. The worker transcodes to an HLS ladder (for example 360p, 540p, 720p, 1080p in H.264 and AAC, which every Android and iOS device plays), makes a poster thumbnail, and writes everything to a "processed" bucket.
6. The worker marks the asset `ready` with its real duration and size, and writes an outbox event. The post becomes visible, and the user gets a "your reel is live" notification. On failure the status becomes `failed` and the app offers a retry.

**Playback and the reels feed**

- Serve HLS through a CDN. Public content uses cacheable URLs; content from private accounts uses signed URLs or signed cookies that expire within hours.
- Android plays HLS with Jetpack Media3 ExoPlayer; iOS plays it natively with AVPlayer, so the same files serve both apps.
- In the reels feed, reuse a pool of 2 or 3 players instead of creating one per reel. Preload the first segments of the next 1 or 2 reels, start at a low bitrate for a fast first frame, cache segments on disk, and release players that scroll off screen.
- Images get resized variants (thumbnail, feed size, full) in WebP or AVIF. The feed never downloads an original 12-megapixel photo.
- Learn videos (3 to 4 minutes) use the same pipeline. The 90-second limit applies only to reels.

**Build or buy the video pipeline**

| Option | Examples | Strength | Cost to watch |
| --- | --- | --- | --- |
| Managed video service | Mux, Cloudflare Stream, Bunny Stream, AWS Elemental MediaConvert with CloudFront | Encoding, adaptive streaming, CDN and thumbnails working within days | Price per minute stored and watched grows with views |
| Self-hosted | FFmpeg workers, S3 or Cloudflare R2, any CDN | Cheapest at large scale, full control | The team owns the encoding queue, retries, failures and tuning |

Start with a managed service, or MediaConvert if the client's stack is on AWS. Keep `media_assets` provider-neutral (a `provider` column and the provider's asset ID) so switching later is a data migration, not a rewrite.

## Search: Elasticsearch with semantic search

Postgres stays the source of truth; Elasticsearch (or its open-source fork OpenSearch) holds a read-only copy built for searching. Semantic search is worth adding for learning content and papers, where people describe an idea in different words. It adds nothing for usernames.

| What people search | Method | Example |
| --- | --- | --- |
| Users | Keyword, prefix and fuzzy matching | "rahm" finds "rahman\_ml"; one typo still matches |
| Posts | Keyword on captions | "transformer notes" |
| Topics | Keyword plus a synonym list | "LLM" also finds "large language model" |
| Learn items and courses | Hybrid: keyword plus semantic | "how do chatbots work" finds the ChatGPT video |
| Papers | Hybrid, with filters for field and year | "making models smaller" finds pruning and distillation papers |
| Related papers, Learn first suggestions | Semantic similarity only | "Papers like this one" on a paper page |

**How it works**

- **Indexes.** One index per type: users, posts, topics, learn, courses, papers. Each is reached through an alias, so a mapping change is a rebuild plus an alias swap, with no downtime. The single search endpoint queries all of them and returns results grouped by type, as in Prototype 1.
- **Semantic part.** When content is published, a worker builds one text per item (title, summary, main idea, research questions) and stores its embedding in the index. Elastic's recommended route is the `semantic_text` field, which runs the embedding model for you. Bringing your own vectors from an embedding API also works.
- **Ranking.** Keyword and semantic results are merged with reciprocal rank fusion (RRF), which Elastic recommends: an item that ranks well in either list rises, so exact matches and meaning matches both surface.
- **Keeping it in sync.** The API never writes to Elasticsearch inside a request. Each change writes a row to `outbox_events` in the same transaction; an indexer worker reads the outbox and updates the index within seconds. A nightly job compares counts and repairs drift.
- **Respecting permissions.** Every query filters out deleted and unpublished items, blocked users, and posts from private accounts. Private posts are left out of search entirely in Prototype 2.
- **Typing speed.** Autocomplete uses a search-as-you-type field. The app waits about 250 ms after the last keystroke and needs at least 2 characters before it calls the API.
- **Running it.** A small managed cluster (Elastic Cloud or Amazon OpenSearch Service) is enough at launch. If it goes down, the endpoint falls back to the Prototype 1 Postgres search, so search degrades instead of breaking.

## Database changes

Prototype 2 changes 13 of the 16 Prototype 1 tables and adds 14, for 30 in total. Embeddings live in Elasticsearch, not Postgres, so no vector extension is needed.

**Changes to Prototype 1 tables**

| Change | Tables | Why |
| --- | --- | --- |
| Add `public_id uuid`, unique; the API and URLs use it, never the numeric `id` | users, posts, comments, notifications, papers, courses, learn\_items, questions | Numeric IDs let anyone count your users or scrape profiles in order. The internal `bigint` key stays for fast joins |
| Add `slug`, unique | topics, fields | Readable links such as `/topics/attention` |
| Case-insensitive unique indexes on `lower(email)` and `lower(username)` | users | Stops `Ali@x.com` and `ali@x.com` becoming two accounts |
| Add `status`, `is_private`, `email_verified_at`, `updated_at`, `deleted_at`; `password_hash` becomes optional | users | Suspension, private accounts, verified email, soft delete; Google-only users have no password |
| Add `status` (`accepted`, `pending`) | follows | Follow requests for private accounts |
| Add `media_id` pointing to `media_assets`, plus `status`, `like_count`, `comment_count`, `updated_at`, `deleted_at`. Drop `media_url` and `duration_seconds` after backfill | posts | Real duration comes from the worker, not the app; counters avoid counting rows on every view; soft delete |
| Add `deleted_at`; `user_id` becomes optional and is set to null when an account is purged | comments | Deleting a comment or an account leaves "\[deleted\]" so reply threads survive |
| Add `status` (`draft`, `published`, `archived`), `published_at`, `created_by`, `updated_by`, `updated_at` | papers, courses, learn\_items, questions | The team drafts and reviews before content goes live, with a record of who changed what |
| Add `media_id` | learn\_items | Learn videos use the same pipeline as reels |
| Make the position constraint `DEFERRABLE` | course\_items, roadmap\_steps | Steps can be reordered in one transaction without breaking the unique rule halfway |

**New tables**

| Table | Holds | Key columns |
| --- | --- | --- |
| `media_assets` | Every uploaded image and video and its processing state | public\_id, owner\_id, kind, purpose, status, provider, provider\_asset\_id, raw\_key, playback\_key, thumbnail\_key, size\_bytes, width, height, duration\_ms |
| `auth_identities` | Google (later Apple) sign-in links | user\_id, provider, provider\_subject |
| `sessions` | One row per signed-in device | user\_id, refresh\_token\_hash, platform, app\_version, push\_token, last\_used\_at, expires\_at, revoked\_at |
| `auth_tokens` | Email verification and password reset codes | user\_id, purpose, token\_hash, expires\_at, used\_at |
| `blocks` | Who blocked whom | blocker\_id, blocked\_id |
| `reports` | User reports for moderation | reporter\_id, target\_type, target\_id, reason, status, reviewed\_by |
| `saved_posts` | Bookmarked posts | user\_id, post\_id |
| `user_fields` | Fields picked at onboarding | user\_id, field\_id |
| `course_progress` | Where a user is in each course | user\_id, course\_id, last\_position, completed\_at |
| `question_attempts` | Practice answers | user\_id, question\_id, answer, is\_correct |
| `quizzes`, `quiz_questions` | Named question sets in order | quiz: title, topic\_id, status; quiz\_questions: quiz\_id, question\_id, position |
| `outbox_events` | Changes waiting for workers (search indexing, notifications, push, counters) | event\_type, entity\_type, entity\_id, payload, processed\_at |
| `audit_log` | Admin and security actions | actor\_id, action, entity\_type, entity\_id, changes, ip |

Account deletion needs no table: it sets `users.status = 'deleted'` and `deleted_at`, hides the account at once, and a purge job removes the data after a 30-day grace period. Refresh tokens and verification codes are stored only as hashes, so a database leak doesn't expose working tokens. The full migration is in the appendix.

## Security

The goal is that a leaked database, a stolen phone or a curious user with a proxy can't reach other people's data. Use the OWASP API Security Top 10 and the OWASP Mobile Application Security Verification Standard (MASVS) as the checklists the production engineers sign off against.

**Authentication**

- Short-lived access tokens (about 15 minutes) and long-lived refresh tokens (30 to 60 days) stored as hashes in `sessions`. Rotate the refresh token on every use; if an old one is ever reused, revoke that whole session, since it means the token was stolen.
- On the phone, keep tokens encrypted with a key held in the Android Keystore (iOS: the Keychain). Never in plain shared preferences, never in logs.
- Hash passwords with argon2id (or bcrypt at cost 12 or more). Minimum 8 characters.
- Google sign-in through Android Credential Manager. The server verifies the Google ID token's signature, audience, issuer and expiry before trusting it.
- Rate-limit sign-in, sign-up, password reset and verification per IP and per account, with growing delays after failures. Password reset says "if that email exists, we sent a link" so it doesn't reveal who has an account.
- Admins and moderators must use two-factor authentication.

**Authorization**

- Check on every request that the caller may see or change that specific object. The most common API breach is changing an ID in a request and getting someone else's data. Put visibility rules (private accounts, blocks, drafts, deleted items) in one shared query layer, not screen by screen.
- Roles: user, moderator, admin, each with the least access it needs.
- Optional extra layer: Postgres row-level security on the most sensitive tables.

**API**

- HTTPS only, with HSTS. Validate every request body against the API schema, with size limits. Errors return a code and a request ID, never a stack trace.
- Rate limits per user, IP and endpoint, kept in Redis: tight on auth, posting and commenting; loose on reading.
- Version the API from day one (`/v1/...`), because old app versions stay installed for months.

**Media**

- Signed upload URLs are tied to one storage key, one file type and a size limit, and expire in minutes.
- The server checks the real file type and duration, and strips GPS and camera metadata. Buckets are private; the CDN serves only processed files.
- Later: automated nudity and violence screening before a post goes live.

**Data**

- Encryption in transit and at rest (default on managed Postgres). Secrets live in a secrets manager, never in the app, the repo or environment files that get committed.
- Separate database users: the app user can read and write rows but can't drop tables; migrations run as a different user.
- Automated backups with point-in-time recovery, and a restore test at least once a quarter.
- Logs never contain passwords, tokens or full email addresses. Admin and security actions go to `audit_log`.

**Privacy and store policy**

- In-app account deletion, plus a web page where users can request deletion without reinstalling. Google Play requires both, and the App Store requires deletion that starts inside the app.
- Fill in the Play Data safety form and, for iOS later, Apple's privacy label; publish a privacy policy. Set a minimum age of 13 in the terms.

**Mobile app hardening**

- Turn on R8 shrinking and obfuscation. Ship no API secrets in the app: anything inside an APK can be extracted.
- Block cleartext HTTP in the network security config.
- Use the Play Integrity API on sign-up and posting to slow down bots and modified apps; use App Attest on iOS later.

**Moderation**

- Reports land in a queue in the admin panel, where moderators remove content or suspend users; every action is logged.
- Blocking hides each user's content from the other, everywhere including search.

## Efficiency

The rule for Prototype 2: a user's request does only the database work needed to answer it; everything else (notifications, counters, indexing, transcoding, email, push) goes through the outbox to workers.

| Area | Prototype 1 | Prototype 2 | Go further when |
| --- | --- | --- | --- |
| Home feed | Join follows and posts on each request | Cursor pagination on `(created_at, id)`; first page cached in Redis for about 60 seconds | Feed queries pass about 100 ms at the 95th percentile: switch to precomputed timelines written when someone posts |
| Reels page | Newest first | A worker scores reels by recency, likes and watch completion and keeps a ranked list in Redis | Enough watch data exists for a recommendation model |
| Counts | `COUNT(*)` on every view | Stored `like_count`, `comment_count`, follower counts, updated from outbox events | Counts change thousands of times a minute: keep them in Redis and flush to Postgres periodically |
| Views and watch time | Not recorded | App sends batched playback events to an analytics store, never to the main Postgres tables | — |
| Pagination | Offset | Cursors everywhere; page size capped at 50 | — |
| Caching | None | Redis for rate limits, hot profiles, paper and course pages, topic lists; ETags on content that rarely changes; CDN for all media | — |
| Background work | Inside the request | Queue and workers fed by `outbox_events` | — |
| Database connections | Direct | PgBouncer connection pooling; a statement timeout of a few seconds; `pg_stat_statements` to find slow queries | — |
| Database growth | One instance | Add a read replica for heavy reads | `notifications` or `question_attempts` reach millions of rows: partition them by month and delete notifications older than 90 days |
| API payloads | Whole rows | Only the fields each screen needs; compressed responses; image URLs at the size the screen shows | — |
| Android app | — | Room database caches the feed and saved papers for instant start and offline reading; Coil for images; WorkManager runs uploads that survive the app closing | — |
| Monitoring | — | Structured logs with request IDs; metrics for latency, errors and queue depth; OpenTelemetry tracing; crash reporting (Crashlytics or Sentry); alerts | — |

## Android now, iOS later

If every rule lives on the server and every file format plays on both platforms, the iOS app later is just a new client for the same API.

- **Server owns the rules.** Permissions, validation, feed ranking, limits and the 90-second check run on the server. The Android app only displays and collects. Describe the API in an OpenAPI spec so the iOS team builds from the same contract.
- **Formats both platforms play.** HLS with H.264 and AAC for video; WebP for images.
- **Push.** Firebase Cloud Messaging covers both (it delivers to iPhones through Apple's push service). Each `sessions` row stores its platform and push token.
- **Links.** Android App Links and iOS Universal Links on the same web domain, with paths built from public IDs and slugs, such as `/p/{public_id}` and `/papers/{slug}`.
- **Sign-in.** Google sign-in works on both. On iOS, Apple requires a privacy-focused login option alongside Google, and Sign in with Apple meets it; `auth_identities` already allows `provider = 'apple'`.
- **Forced updates.** A small endpoint returns the minimum supported app version per platform, so a security fix can require an update.
- **Shared code.** If the Android app is native Kotlin, Kotlin Multiplatform can share the networking and data layer with iOS later. If the client's plan names Flutter or React Native, one codebase covers both from the start, and this section mostly applies to the server.

## Build order

Do the data-shape changes first: they get harder with every user, while features can be added at any time.

1. **Foundations.** Adopt a migration tool. Add public IDs, case-insensitive uniques, soft deletes and status columns. Add sessions with refresh rotation, rate limits, a secrets manager and backups.
2. **Media pipeline.** `media_assets`, signed uploads, transcoding, CDN playback, the reels player pool.
3. **Outbox and workers.** Counters, in-app notifications, push through FCM, email.
4. **Admin panel.** Drafts and publishing for papers, courses, learn items and questions; the reports queue; the audit log.
5. **Store requirements.** Account deletion in the app and on the web, block and report, Data safety form, privacy policy.
6. **Search.** Elasticsearch keyword search with the outbox indexer first, then semantic and hybrid ranking for Learn and Research.
7. **Learning features.** Course progress, practice history, quizzes, onboarding interests, saved posts, deep links, private accounts.
8. **Hardening before public launch.** Play Integrity, monitoring and alerts, a load test of the feed and reels, and a security review against the OWASP API and MASVS checklists, ideally with an outside penetration test.

## Appendix: SQL migration

Runs on top of the Prototype 1 schema in one transaction. Tested on PostgreSQL 16 with existing data: it ends with 30 tables, keeps Prototype 1 content published, allows reordering roadmap steps in one transaction, keeps a reply thread when an account is purged, and rejects case-only duplicate emails and usernames. Put it into your migration tool as the first Prototype 2 migration rather than running it by hand.

```sql
-- Prototype 2 migration: run on top of the Prototype 1 schema.
-- Tested on PostgreSQL 16. On PostgreSQL 18, swap gen_random_uuid() for uuidv7()
-- (time-ordered IDs index better), or generate UUIDv7 in the app.

BEGIN;

-- ============ 1. Public IDs and slugs ============

ALTER TABLE users         ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE posts         ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE comments      ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE notifications ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE papers        ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE courses       ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE learn_items   ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE questions     ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

ALTER TABLE topics ADD COLUMN slug text UNIQUE;  -- backfill, then SET NOT NULL
ALTER TABLE fields ADD COLUMN slug text UNIQUE;

-- ============ 2. Users ============

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL,  -- Google-only accounts have no password
  ADD COLUMN status text NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'suspended', 'deleted')),
  ADD COLUMN is_private        boolean NOT NULL DEFAULT false,
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_at        timestamptz;  -- purge job removes data 30 days later

ALTER TABLE users DROP CONSTRAINT users_role_check,
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'moderator', 'admin'));

CREATE UNIQUE INDEX users_email_lower_key    ON users (lower(email));
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

ALTER TABLE follows
  ADD COLUMN status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending'));

-- ============ 3. Media ============

CREATE TABLE media_assets (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  owner_id          bigint REFERENCES users(id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN ('image', 'video')),
  purpose           text NOT NULL CHECK (purpose IN ('post', 'avatar', 'learn', 'paper_figure')),
  status            text NOT NULL DEFAULT 'uploading'
                    CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  provider          text NOT NULL DEFAULT 'self',  -- e.g. 'mux', 'cloudflare', 'self'
  provider_asset_id text,
  raw_key           text,  -- original upload in the private raw bucket
  playback_key      text,  -- HLS manifest for video, base key for image variants
  thumbnail_key     text,
  mime_type         text,
  size_bytes        bigint CHECK (size_bytes > 0),
  width             integer,
  height            integer,
  duration_ms       integer,  -- measured by the worker, never taken from the app
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON media_assets (owner_id);
CREATE INDEX ON media_assets (status) WHERE status IN ('uploading', 'processing');

-- ============ 4. Posts and comments ============

ALTER TABLE posts
  ADD COLUMN media_id      bigint REFERENCES media_assets(id),
  ADD COLUMN status        text NOT NULL DEFAULT 'published'
                           CHECK (status IN ('processing', 'published', 'removed')),
  ADD COLUMN like_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN comment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_at    timestamptz;

-- Feed and profile pages with cursor pagination on (created_at, id)
CREATE INDEX posts_user_feed_idx ON posts (user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND status = 'published';

-- After backfilling media_id from media_url, run separately:
--   ALTER TABLE posts DROP COLUMN media_url, DROP COLUMN duration_seconds;
--   ALTER TABLE posts ADD CHECK (type = 'text' OR media_id IS NOT NULL);
-- (The reel length check then lives in the worker, using media_assets.duration_ms.)

ALTER TABLE comments
  ADD COLUMN deleted_at timestamptz,
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE comments DROP CONSTRAINT comments_user_id_fkey,
  ADD CONSTRAINT comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;  -- thread survives a purge

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow', 'follow_request', 'like', 'comment', 'reply', 'post_ready'));

-- ============ 5. Publishing workflow for team content ============

ALTER TABLE papers
  ADD COLUMN status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();
ALTER TABLE courses
  ADD COLUMN status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();
ALTER TABLE learn_items
  ADD COLUMN status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN media_id     bigint REFERENCES media_assets(id);
ALTER TABLE questions
  ADD COLUMN status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();

-- Prototype 1 content was already live: keep it published.
UPDATE papers      SET status = 'published', published_at = created_at;
UPDATE courses     SET status = 'published', published_at = created_at;
UPDATE learn_items SET status = 'published', published_at = created_at;
UPDATE questions   SET status = 'published', published_at = now();

-- Reordering steps in one transaction
ALTER TABLE course_items DROP CONSTRAINT course_items_pkey,
  ADD CONSTRAINT course_items_pkey PRIMARY KEY (course_id, position) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE roadmap_steps DROP CONSTRAINT roadmap_steps_pkey,
  ADD CONSTRAINT roadmap_steps_pkey PRIMARY KEY (field_id, position) DEFERRABLE INITIALLY DEFERRED;

-- ============ 6. Auth ============

CREATE TABLE auth_identities (
  provider         text NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject text NOT NULL,  -- the provider's stable user ID ("sub")
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX ON auth_identities (user_id);

CREATE TABLE sessions (  -- one row per signed-in device
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,  -- hash only; rotated on every refresh
  platform           text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version        text,
  push_token         text,  -- FCM token for this device
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (  -- email verification and password reset
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_tokens (user_id);

-- ============ 7. Safety and moderation ============

CREATE TABLE blocks (
  blocker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX ON blocks (blocked_id);

CREATE TABLE reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id bigint REFERENCES users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('user', 'post', 'comment')),
  target_id   bigint NOT NULL,  -- no FK on purpose: the report outlives its target
  reason      text NOT NULL
              CHECK (reason IN ('spam', 'harassment', 'nudity', 'violence', 'misinformation', 'other')),
  details     text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reports (status, created_at);
CREATE INDEX ON reports (target_type, target_id);

-- ============ 8. New user features ============

CREATE TABLE saved_posts (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE user_fields (  -- interests picked at onboarding
  user_id  bigint NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  field_id bigint NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, field_id)
);

CREATE TABLE course_progress (
  user_id       bigint   NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id     bigint   NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  last_position smallint NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE question_attempts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer      text,
  is_correct  boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON question_attempts (user_id, created_at DESC);

CREATE TABLE quizzes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id  uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  title      text NOT NULL,
  topic_id   bigint REFERENCES topics(id) ON DELETE SET NULL,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quiz_questions (
  quiz_id     bigint   NOT NULL REFERENCES quizzes(id)   ON DELETE CASCADE,
  question_id bigint   NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    smallint NOT NULL,
  PRIMARY KEY (quiz_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (quiz_id, question_id)
);

-- ============ 9. Workers and audit ============

CREATE TABLE outbox_events (  -- written in the same transaction as the change
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   text NOT NULL,  -- e.g. 'post.created', 'paper.published', 'comment.created'
  entity_type  text NOT NULL,
  entity_id    bigint NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (id) WHERE processed_at IS NULL;

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,  -- e.g. 'paper.publish', 'user.suspend', 'report.action'
  entity_type text,
  entity_id   bigint,
  changes     jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (entity_type, entity_id);
CREATE INDEX ON audit_log (actor_id, created_at DESC);

COMMIT;
```

## Sources

- [Understanding Google Play's app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111) — in-app deletion path plus a web link
- [Apple: Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app) — deletion must start inside the app
- [Elastic: Hybrid search](https://www.elastic.co/docs/solutions/search/hybrid-search) — `semantic_text` workflow and RRF recommended
