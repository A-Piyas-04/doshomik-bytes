# Database architecture

Status as of Nov 23, 2026 (Prototype 2 backend, after migration `…004`). Source of truth: the SQL files in [`apps/api/migrations/`](../../apps/api/migrations/). Generated TypeScript types: [`apps/api/src/db/types.ts`](../../apps/api/src/db/types.ts). An interactive version of this page, with a relationship map, is in [`Schema-Explorer.html`](Schema-Explorer.html).

Related: [Backend architecture](backend-architecture.md) · [Implementation notes and decisions](../prototype-2-implementation-notes.md) · [API reference](../../apps/api/README.md)

## Contents

1. [Overview](#1-overview)
2. [Conventions](#2-conventions)
3. [Entity–relationship diagram](#3-entityrelationship-diagram)
4. [Tables by domain](#4-tables-by-domain)
5. [Write paths and efficiency](#5-write-paths-and-efficiency)
6. [Indexes](#6-indexes)
7. [Integrity rules and delete behaviour](#7-integrity-rules-and-delete-behaviour)
8. [Data lifecycle and retention](#8-data-lifecycle-and-retention)
9. [Migrations](#9-migrations)
10. [Known gaps and planned changes](#10-known-gaps-and-planned-changes)

---

## 1. Overview

| Item | Value |
| --- | --- |
| Engine | PostgreSQL 16+ (works on 13+; `gen_random_uuid()` is built in) |
| Extensions | `pg_trgm` (fuzzy search on usernames and topic names) |
| Tables | 30, in 8 domains |
| Foreign keys | 55: 36 cascade, 16 set null, 3 restrict |
| Query layer | Kysely (typed SQL builder), `pg` driver, one connection pool per process |
| Migrations | node-pg-migrate, plain SQL files, each run in its own transaction |
| Statement timeout | `DB_STATEMENT_TIMEOUT_MS` (default 5000 ms) on every pooled connection |
| Databases | `doshomik` (development), `doshomik_test` (wiped and migrated by the test run) |

There is no Redis, Elasticsearch or separate queue. Postgres also serves as:

- the **job queue**: `outbox_events`, and `media_assets` rows with `status = 'processing'`;
- the **search engine**: `tsvector` GIN and trigram indexes;
- the **audit store**: `audit_log`.

## 2. Conventions

| Convention | Detail |
| --- | --- |
| Internal keys | `id bigint GENERATED ALWAYS AS IDENTITY`. Used for joins only and **never sent to clients**. |
| Public keys | `public_id uuid DEFAULT gen_random_uuid() UNIQUE` on every row a client can name: users, posts, comments, notifications, papers, courses, learn items, questions, quizzes, media assets and sessions. |
| Slugs | `topics.slug` and `fields.slug` (`NOT NULL UNIQUE`) name those rows in URLs. |
| Enums | `text` columns with `CHECK (... IN (...))`, not Postgres enum types. They are easier to change in a migration. The same lists are in [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts), so change both together. |
| Timestamps | `timestamptz`. `created_at DEFAULT now()` everywhere; `updated_at` on mutable rows, set by the application, not by triggers. |
| Soft delete | `deleted_at` on `users`, `posts` and `comments`. Rows are hidden at once and purged later (§8). |
| **Toggle rows** | A relationship whose creation has side effects (a notification, a counter) keeps **one row per pair** and flips a state instead of being deleted and re-inserted: `post_likes.is_active` and `follows.status = 'inactive'`. Only the first activation ever notifies (§5). |
| Stored counters | `posts.like_count`, `posts.comment_count`, `users.follower_count`, `users.following_count`. Moved **±1** by the worker, exactly once per outbox event, and recounted hourly by the repair job (§5). |
| Publishing workflow | Team content (`papers`, `courses`, `learn_items`, `questions`, `quizzes`) has `status` `draft` → `published` → `archived`. Most also have `published_at`, `created_by` and `updated_by`. |
| Storage keys, not URLs | `media_assets` stores `raw_key`, `playback_key` and `thumbnail_key`. URLs are built at read time, so changing storage provider changes no data. |
| Join tables | Composite primary keys, e.g. `follows (follower_id, following_id)`. |
| Ordered children | `position smallint` in the primary key (`course_items`, `roadmap_steps`, `quiz_questions`), made `DEFERRABLE INITIALLY DEFERRED` so a whole list can be reordered in one transaction. |
| Polymorphic references | `reports.target_id`, `outbox_events.entity_id` and `audit_log.entity_id` have **no foreign key** on purpose: these rows must outlive their targets. |

## 3. Entity–relationship diagram

Keys and relationships only; columns are listed in §4. `||--o{` means one-to-many. `users` is the hub: 30 foreign keys from 22 tables point at it.

```mermaid
erDiagram
    users ||--o{ follows : "follower / following"
    users ||--o{ blocks : "blocker / blocked"
    users ||--o{ posts : writes
    users ||--o{ post_likes : likes
    users ||--o{ saved_posts : saves
    users ||--o{ comments : writes
    users ||--o{ notifications : "receives / causes"
    users ||--o{ media_assets : owns
    users ||--o{ sessions : "signs in on"
    users ||--o{ auth_identities : "linked to"
    users ||--o{ auth_tokens : "gets codes"
    users ||--o{ reports : "files / reviews"
    users ||--o{ user_fields : "is interested in"
    users ||--o{ user_papers : tracks
    users ||--o{ course_progress : "progresses in"
    users ||--o{ question_attempts : answers
    users ||--o{ audit_log : "acts in"

    media_assets ||--o{ posts : "media of"
    media_assets ||--o{ learn_items : "media of"

    posts ||--o{ post_likes : ""
    posts ||--o{ saved_posts : ""
    posts ||--o{ comments : ""
    posts ||--o{ notifications : ""
    comments ||--o{ comments : "replies"
    comments ||--o{ notifications : ""

    fields ||--o{ papers : contains
    fields ||--o{ roadmap_steps : "roadmap"
    fields ||--o{ user_fields : ""
    papers ||--o{ roadmap_steps : "step of"
    papers ||--o{ paper_prerequisites : "learn first"
    papers ||--o{ user_papers : ""
    papers ||--o{ comments : "discussion"

    topics ||--o{ paper_prerequisites : ""
    topics ||--o{ learn_items : ""
    topics ||--o{ questions : ""
    topics ||--o{ quizzes : ""

    courses ||--o{ course_items : ""
    learn_items ||--o{ course_items : "step of"
    courses ||--o{ course_progress : ""

    questions ||--o{ quiz_questions : ""
    quizzes ||--o{ quiz_questions : ""
    questions ||--o{ question_attempts : ""

    outbox_events {
        bigint id PK
        text event_type
        text entity_type
        bigint entity_id "no FK"
    }
```

Not shown: `created_by` and `updated_by` on team content, and `reports.target_id` (polymorphic, no FK). The full list of foreign keys with their delete rules is in §7 and, filterable, in the [Schema Explorer](Schema-Explorer.html#map).

## 4. Tables by domain

Columns are listed as they are **after all five migrations**. PK = primary key, FK = foreign key, U = unique. Columns added by migration `…004` are marked **(004)**.

### 4.1 Accounts and authentication

**`users`**: one row per account.

| Column | Type | Notes |
| --- | --- | --- |
| id | bigint PK | |
| public_id | uuid U | Exposed as `id` in the API |
| username | text U | Also unique on `lower(username)`; pattern `^[a-z0-9_.]{3,30}$` (enforced in the app) |
| email | text U | Also unique on `lower(email)` |
| password_hash | text, nullable | Argon2id. NULL for Google-only accounts |
| display_name, bio, avatar_url | text | `avatar_url` is set by the worker when an avatar upload is ready |
| role | text | `user` · `moderator` · `admin` |
| status | text | `active` · `suspended` · `deleted` |
| is_private | boolean | Private accounts need accepted follow requests |
| follower_count, following_count **(004)** | integer | Stored counts of **accepted** follows. Moved ±1 by the worker on `follow.changed`; repaired hourly |
| email_verified_at | timestamptz | |
| totp_secret | text | AES-256-GCM encrypted by the API |
| totp_enabled_at | timestamptz | Two-factor sign-in; required for staff routes |
| created_at, updated_at, deleted_at | timestamptz | `deleted_at` starts the 30-day purge clock |

**`sessions`**: one row per signed-in device.

| Column | Type | Notes |
| --- | --- | --- |
| id | bigint PK | |
| public_id | uuid U | The `sid` claim in access tokens; part of the refresh token |
| user_id | FK → users, cascade | |
| refresh_token_hash | text U | SHA-256 of the secret; replaced on every refresh |
| platform | text | `android` · `ios` · `web` |
| app_version, push_token | text | `push_token` is the device's FCM token |
| created_at, last_used_at, expires_at, revoked_at | timestamptz | Sliding 30-day expiry |

**`auth_identities`**: outside sign-in links. PK `(provider, provider_subject)`; `provider` is `google` or `apple`; `user_id` FK → users, cascade.

**`auth_tokens`**: one-time email codes. `purpose` is `verify_email` (24 h) or `reset_password` (1 h); `token_hash` U (the plain code is only in the email); `expires_at`, `used_at`.

### 4.2 Social graph and safety

**`follows`**: the follow graph, one row per pair for ever (a toggle row).

| Column | Type | Notes |
| --- | --- | --- |
| follower_id, following_id | PK, FK → users, cascade | `CHECK follower_id <> following_id` |
| status | text | `accepted` · `pending` (a request to a private account) · `inactive` **(004)** (unfollowed, withdrawn, declined, or ended by a block) |
| created_at | timestamptz | The first follow ever |
| updated_at **(004)** | timestamptz | When the current status began. Follow requests are listed by it |

The API reports `inactive` as `follow_status: "none"`. Every privacy check tests `status = 'accepted'`, so inactive rows need no extra filter there.

| Table | Key | Columns | Notes |
| --- | --- | --- | --- |
| `blocks` | PK (blocker_id, blocked_id) | created_at | Applies both ways in every visibility check; blocking also ends follows in both directions (sets them `inactive`) |
| `reports` | id PK | reporter_id, target_type `user` · `post` · `comment`, target_id (no FK), reason, details, status `open` · `actioned` · `dismissed`, reviewed_by, reviewed_at | Reasons: `spam`, `harassment`, `nudity`, `violence`, `misinformation`, `other` |

### 4.3 Media

**`media_assets`**: every uploaded image or video, whatever it is used for.

| Column | Type | Notes |
| --- | --- | --- |
| id, public_id | bigint PK, uuid U | |
| owner_id | FK → users, set null | |
| kind | text | `image` · `video` |
| purpose | text | `post` · `avatar` · `learn` · `paper_figure` |
| status | text | `uploading` → `processing` → `ready` or `failed` |
| provider, provider_asset_id | text | `self` (FFmpeg worker), `legacy` (Prototype 1 files); later a managed provider |
| raw_key | text | Original upload in private raw storage; deleted after processing |
| playback_key | text | HLS master playlist (video) or base key of the WebP variants (image) |
| thumbnail_key | text | Poster frame or small image |
| mime_type, size_bytes, width, height, duration_ms | | `duration_ms` is measured by the worker, never taken from the client |
| error | text | Message shown to the user when `failed` |
| created_at, updated_at | timestamptz | |

### 4.4 Posts, comments and notifications

**`posts`**

| Column | Type | Notes |
| --- | --- | --- |
| id, public_id | bigint PK, uuid U | |
| user_id | FK → users, cascade | |
| type | text | `text` · `image` · `reel` |
| caption | text | Required for `text` posts |
| media_id | FK → media_assets, restrict | Required unless `type = 'text'` |
| status | text | `processing` (media not ready) · `published` · `removed` (by a moderator) |
| like_count, comment_count | integer | Stored counters, moved ±1 by the worker (§5) |
| created_at, updated_at, deleted_at | timestamptz | |

**`post_likes`**: one row per user and post for ever (a toggle row).

| Column | Type | Notes |
| --- | --- | --- |
| user_id | PK, FK → users, cascade | |
| post_id | PK, FK → posts, cascade | |
| is_active **(004)** | boolean | `false` after an unlike; a re-like sets it back. Deliberately in no index (§5) |
| created_at | timestamptz | The first like ever |
| updated_at **(004)** | timestamptz | Last toggle |

| Table | Key | Notes |
| --- | --- | --- |
| `saved_posts` | PK (user_id, post_id) | Plain delete + insert on purpose: no side effects, and a re-save must move the post to the top of the list (§5) |
| `comments` | id PK, public_id U | Attached to **exactly one** of `post_id` or `paper_id` (CHECK), both cascade. `parent_id` → comments (cascade) for replies. `user_id` is nullable with `ON DELETE SET NULL`, so threads survive a purged account. `deleted_at` leaves a `[deleted]` placeholder. No `updated_at` |
| `notifications` | id PK, public_id U | `user_id` receives it, `actor_id` caused it (both cascade). Types: `follow`, `follow_request`, `like`, `comment`, `reply`, `post_ready`. Optional `post_id` and `comment_id` (cascade). `is_read`. Written only by the worker |

### 4.5 Learn

| Table | Key | Columns / notes |
| --- | --- | --- |
| `topics` | id PK, name U, slug U | `summary`, shown in "Learn first" when a topic has no learn items yet |
| `learn_items` | id PK, public_id U | `topic_id` (set null), `title`, `kind` `video` · `image` · `text`, `body`, `duration_seconds`, `media_url` (outside link) **or** `media_id` (uploaded media, restrict) unless `kind = 'text'`, plus the publishing columns |
| `courses` | id PK, public_id U | `title`, `description`, `thumbnail_url`, `external_url` (a free outside course has no items), plus the publishing columns |
| `course_items` | PK (course_id, position) deferrable; U (course_id, item_id) | Ordered steps of a course; both FKs cascade |
| `course_progress` | PK (user_id, course_id) | `last_position`, `completed_at` (first completion kept), `updated_at`. Written with one upsert |

### 4.6 Practice

| Table | Key | Columns / notes |
| --- | --- | --- |
| `questions` | id PK, public_id U | `topic_id` (cascade), `kind` `mcq` · `short`, `prompt`, `options text[]` (≥ 2 for MCQ), `answer`, `explanation`, plus the publishing columns. No `created_at` (inherited from Prototype 1) |
| `question_attempts` | id PK | `user_id`, `question_id`, `answer`, `is_correct`, `created_at`. Append-only history; powers accuracy per topic and streak days (`APP_TIMEZONE`) |
| `quizzes` | id PK, public_id U | `title`, `topic_id` (set null), `status`, `created_by` (no `published_at` or `updated_by`) |
| `quiz_questions` | PK (quiz_id, position) deferrable; U (quiz_id, question_id) | |

### 4.7 Research

| Table | Key | Columns / notes |
| --- | --- | --- |
| `fields` | id PK, name U, slug U | `description`. Can't be deleted while it has papers |
| `papers` | id PK, public_id U | `field_id` (restrict), `title`, `authors`, `year`, `paper_url`, `research_questions text[]`, `main_idea`, `data_source`, `method_steps text[]` (in order), `results`, `figures jsonb` (`[{url, caption}]`), `limitations`, `evaluation`, plus the publishing columns |
| `paper_prerequisites` | PK (paper_id, topic_id) | "Learn first" topics, with `position` |
| `roadmap_steps` | PK (field_id, position) deferrable; U (field_id, paper_id) | One starting roadmap per field; `note` explains the step |
| `user_papers` | PK (user_id, paper_id) | Reading tracker: `saved` · `reading` · `completed`, `updated_at`. Written with one upsert |
| `user_fields` | PK (user_id, field_id) | Interests picked at onboarding. Saving writes only the difference |

### 4.8 System

| Table | Purpose | Notes |
| --- | --- | --- |
| `outbox_events` | Work for the background worker, written **in the same transaction** as the change | `event_type`, `entity_type`, `entity_id`, `payload jsonb`, `attempts`, `processed_at`. The worker claims an event by setting `processed_at` only while it is still NULL (§5). Event types are listed in [backend architecture §6](backend-architecture.md#6-outbox-events) |
| `audit_log` | Every admin and security action | `actor_id` (set null), `action` (e.g. `paper.publish`, `user.suspend`, `user.purge`), `entity_type`, `entity_id`, `changes jsonb`, `ip inet` |

## 5. Write paths and efficiency

The rule: a request does only the database work needed to answer it, and the worker does the rest through the outbox. Migration `…004` and its code changes removed the places where rows were thrown away and recreated, or where the same counting was repeated on every read or event. The decisions are recorded in [implementation notes §2.6](../prototype-2-implementation-notes.md#26-efficiency-pass-migration-004-23-nov-2026).

### 5.1 Likes: one row, toggled

```
PUT  /posts/:id/like    INSERT … ON CONFLICT (user_id, post_id)
                        DO UPDATE SET is_active = true, updated_at = now() WHERE NOT is_active
                        RETURNING (xmax = 0) AS first_like
                          no row back  → already liked: nothing written, no event
                          first_like   → event post.liked {first_like: true}  → +1, notify
                          re-like      → event post.liked {first_like: false} → +1, no notification
DELETE /posts/:id/like  UPDATE … SET is_active = false WHERE is_active
                          row back     → event post.unliked → −1
```

- **No notification spam.** Like → unlike → like used to send a new notification and push each time. Now only the first like ever notifies.
- **Cheaper toggles.** `is_active` and `updated_at` are in no index, so a toggle is a HOT update with no index writes. Delete + insert wrote entries into both the primary key and `post_likes (post_id)` every time.
- **No-op requests write nothing.** Liking an already-liked post, or unliking a post you never liked, writes no row and no event.
- `liked_by_me` checks `is_active`. Inactive rows stay until the user or the post is purged.

### 5.2 Follows: one row, toggled by status

| Action | Row change | Events |
| --- | --- | --- |
| Follow a public account | insert, or `inactive` → `accepted` | `follow.created` (first follow only) · `follow.changed +1` |
| Request a private account | insert, or `inactive` → `pending` | `follow.created` (first request only) |
| Accept a request; account goes public | `pending` → `accepted` | `follow.changed +1` per follower |
| Unfollow | `accepted` → `inactive` | `follow.changed −1` |
| Withdraw / decline a request | `pending` → `inactive` | none |
| Block (both directions) | live follows → `inactive` | `follow.changed −1` for each accepted one |

A re-sent request after a decline appears in the requests list (ordered by `updated_at`) without a new alert. Block ends follows as `inactive` rather than deleting them, so block → unblock → follow can't re-notify either.

### 5.3 Stored counters

| Counter | Moved by | Before `…004` |
| --- | --- | --- |
| `posts.like_count` | `post.liked` +1, `post.unliked` −1 | Recounted all likes **and** all comments of the post on every event |
| `posts.comment_count` | `comment.created` +1, `comment.deleted` −1 | Same recount |
| `users.follower_count`, `following_count` | `follow.changed` ±1 on both users | `COUNT(*)` on every profile view; "people to follow" counted followers for every active user, then sorted |

±1 updates are safe because each event is applied **exactly once**. The worker claims it (`UPDATE outbox_events SET processed_at = now() WHERE id = $1 AND processed_at IS NULL`) and runs its handler in the same transaction. If the handler fails, the claim rolls back too, and a second worker that picked the same event finds it claimed and skips it. Events are written only when the state really changes, so a delta always matches a real change. Values are floored at 0.

Paths that write no event, mainly account purges (cascaded likes and follows, blanked comments), can leave a count off. The hourly `repairCounters` job recounts and fixes any drift.

### 5.4 Other fixes

- **Interests** (`user_fields`): saving deletes only removed fields and inserts only new ones; before, every save deleted and re-inserted all rows.
- **Unread badge**: `notifications_unread_idx (user_id) WHERE NOT is_read`, matched by the literal `NOT n.is_read` in the query.
- **Redundant index dropped**: the Prototype 1 `posts (created_at DESC) WHERE type = 'reel'`, superseded by `posts_reels_idx`.

### 5.5 Reviewed and left as they are

| Table | Why |
| --- | --- |
| `saved_posts` | No side effects on re-create, so a toggle would only add a filter to every read. A re-save must move the post to the top of the list, which rewrites the indexed `created_at` anyway |
| `user_papers`, `course_progress` | Already one upsert on the same row |
| `blocks` | Rare, no side effects |
| `question_attempts` | Append-only by design: each attempt is history |
| `posts_count` on profiles | Still `COUNT(*)`, served by the partial `posts_user_feed_idx`; store it if profiles get hot |

## 6. Indexes

Besides primary keys and unique constraints:

| Purpose | Index |
| --- | --- |
| Profile pages and home feed (keyset on `created_at, id`) | `posts_user_feed_idx (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL AND status = 'published'` |
| A user's posts in any status; the user cascade | `posts (user_id, created_at DESC)` |
| Reels list | `posts_reels_idx (created_at DESC, id DESC) WHERE type = 'reel' AND status = 'published' AND deleted_at IS NULL` |
| Posts waiting on a media asset | `posts (media_id)` |
| People to follow **(004)** | `users_suggest_idx (follower_count DESC, id DESC) WHERE status = 'active'` |
| Who follows me; the user cascade | `follows (following_id)` |
| Pending follow requests **(004: now on `updated_at`)** | `follows_pending_idx (following_id, updated_at DESC) WHERE status = 'pending'` |
| Block checks from the blocked side | `blocks (blocked_id)` |
| Likes per post (repair job, post cascade); `is_active` left out on purpose | `post_likes (post_id)` |
| Comments per post and paper; replies | `comments (post_id, created_at)`, `comments (paper_id, created_at)`, `comments (parent_id)` |
| Notifications inbox | `notifications (user_id, created_at DESC)` |
| Unread badge **(004)** | `notifications_unread_idx (user_id) WHERE NOT is_read` |
| Saved posts | `saved_posts (user_id, created_at DESC)` |
| Practice history and stats | `question_attempts (user_id, created_at DESC)` |
| Live sessions | `sessions (user_id) WHERE revoked_at IS NULL` |
| Lookups and cascades by user | `auth_identities (user_id)`, `auth_tokens (user_id)` |
| Media queue | `media_assets (status) WHERE status IN ('uploading', 'processing')`, `media_assets (owner_id)` |
| Content by field or topic | `papers (field_id)`, `learn_items (topic_id)`, `questions (topic_id)` |
| Outbox queue | `outbox_pending_idx (id) WHERE processed_at IS NULL` |
| Moderation queue | `reports (status, created_at)`, `reports (target_type, target_id)` |
| Audit lookups | `audit_log (entity_type, entity_id)`, `audit_log (actor_id, created_at DESC)` |
| Case-insensitive login | unique `lower(email)`, unique `lower(username)` |
| Fuzzy search | GIN trigram on `users.username` and `topics.name` |
| Full-text search | GIN `to_tsvector('english', …)` on `posts.caption`, `learn_items` (title + body), `courses` (title + description), `papers` (title + main_idea) |

> The full-text expressions in [`src/db/search.ts`](../../apps/api/src/db/search.ts) must match the index expressions **exactly**, or Postgres won't use the indexes. The same goes for partial-index predicates: write the query's condition the way the index states it.

## 7. Integrity rules and delete behaviour

**CHECK constraints**

- **Post media.** `CHECK (type = 'text' OR media_id IS NOT NULL)`. The 90-second reel limit lives in the media worker (`media_assets.duration_ms`), not in a CHECK.
- **Comments target.** `CHECK ((post_id IS NULL) <> (paper_id IS NULL))`.
- **MCQ options.** `CHECK (kind = 'short' OR cardinality(options) >= 2)`.
- **Learn items.** `CHECK (kind = 'text' OR media_url IS NOT NULL OR media_id IS NOT NULL)`.
- **Follow status.** `CHECK (status IN ('accepted', 'pending', 'inactive'))`.
- **No self-follow or self-block** (CHECKs).

**Foreign keys by delete rule**

| Rule | Foreign keys |
| --- | --- |
| **cascade** (36): the child row goes with the parent | Every `user_id`-style column of user-owned rows (`sessions`, `auth_identities`, `auth_tokens`, `follows` ×2, `blocks` ×2, `posts`, `post_likes`, `saved_posts`, `notifications.user_id`/`actor_id`, `user_papers`, `user_fields`, `course_progress`, `question_attempts`); post children (`post_likes`, `saved_posts`, `comments`, `notifications`); `comments.paper_id`, `comments.parent_id`, `notifications.comment_id`; ordered children (`course_items` ×2, `quiz_questions` ×2, `roadmap_steps` ×2, `paper_prerequisites` ×2); `questions.topic_id`, `question_attempts.question_id`, `course_progress.course_id`, `user_papers.paper_id`, `user_fields.field_id` |
| **set null** (16): the row survives, the link is forgotten | `comments.user_id`, `media_assets.owner_id`, `reports.reporter_id`/`reviewed_by`, `audit_log.actor_id`, `created_by`/`updated_by` on papers, courses, learn items and questions, `quizzes.created_by`, `learn_items.topic_id`, `quizzes.topic_id` |
| **restrict** (3, `NO ACTION`): delete refused while referenced → `409 IN_USE` | `posts.media_id`, `learn_items.media_id` → `media_assets`; `papers.field_id` → `fields` |

Deleting a user therefore removes their posts (and everything hanging off them), likes, saves, follows, blocks, sessions, identities, codes, progress, attempts and notifications. Comments, reports, media ownership, audit entries and `created_by`/`updated_by` are **set null** instead.

**Constraint errors become API errors.** Unique → `409 ALREADY_EXISTS`; FK still referenced → `409 IN_USE`; missing FK target → `400 INVALID_REFERENCE`; CHECK / NOT NULL / bad format → `400 INVALID_DATA` ([`src/lib/error-handler.ts`](../../apps/api/src/lib/error-handler.ts)).

## 8. Data lifecycle and retention

The worker's hourly maintenance ([`src/worker/maintenance.ts`](../../apps/api/src/worker/maintenance.ts)) enforces these. Every job can safely run more than once.

| Data | Rule |
| --- | --- |
| Deleted accounts | `status = 'deleted'` hides them at once. After `ACCOUNT_PURGE_DAYS` (30): their comments are blanked into `[deleted]` placeholders, the user row is deleted (cascading), their post and avatar media rows and files are removed, and a `user.purge` audit entry is written |
| Deleted posts | Hidden at once; after 30 days the row and its media are deleted |
| Stored counters | Post like/comment counts and user follower/following counts recounted wherever they drifted |
| Inactive likes and follows | Kept: they are what prevents re-notification. Removed with the user or post |
| Abandoned uploads | `uploading` or `failed` assets older than 1 day that no post or learn item uses |
| Sessions | Expired or revoked more than 30 days ago |
| Email codes | Expired or used more than 7 days ago |
| Outbox events | Processed more than 30 days ago. Events with `attempts >= 10` stay for inspection (dead letters) |
| Raw uploads | Deleted as soon as processing ends, success or failure (they contain GPS and camera metadata) |

## 9. Migrations

| File | What it does |
| --- | --- |
| `1795305600000_prototype-v1-schema.sql` | The Prototype 1 schema: 16 tables, `pg_trgm`, search indexes |
| `1795305600001_prototype-2.sql` | The Prototype 2 appendix SQL, unchanged except without its `BEGIN`/`COMMIT`: public ids, slugs, user status and privacy, `media_assets`, the publishing workflow, auth tables, safety tables, new feature tables, outbox and audit (14 new tables) |
| `1795305600002_prototype-2-backfill.sql` | Generates slugs and sets them `NOT NULL`; moves Prototype 1 post media into `media_assets` (`provider = 'legacy'`); drops `posts.media_url` and `duration_seconds`; relaxes the learn item media check |
| `1795305600003_sessions-public-id-and-2fa.sql` | `sessions.public_id`, `users.totp_secret` and `totp_enabled_at`, and four indexes for the feed, reels, saves and follow requests |
| `1795305600004_toggles-and-stored-counts.sql` | `post_likes.is_active`/`updated_at`; `follows` status `inactive` and `updated_at` (pending index moved to it); `users.follower_count`/`following_count` with a backfill; `users_suggest_idx`; `notifications_unread_idx`; drops the redundant Prototype 1 reels index |

Rules:

- **Never edit a migration that has been applied.** Add a new one. The project skill [`.claude/skills/doshomik-migration`](../../.claude/skills/doshomik-migration/SKILL.md) has the checklist.
- Every migration has a working `-- Down Migration`. The `…002` down migration loses data for Prototype 2 uploads; the `…004` down migration deletes inactive likes and follows (they were deleted before it).
- After changing the schema, run `pnpm db:types` to regenerate `src/db/types.ts`, and update the enum lists in `packages/shared` if a CHECK changed.

## 10. Known gaps and planned changes

Details and steps are in [the implementation notes](../prototype-2-implementation-notes.md) §3–4.

| Gap | Plan |
| --- | --- |
| Random UUIDv4 public ids | Switch defaults to `uuidv7()` once production is on PostgreSQL 18 (better index locality) |
| One worker only (advisory lock) | Add `locked_until` lease columns to `outbox_events` and `media_assets`, then claim rows with `FOR UPDATE SKIP LOCKED`. The claim step already makes a second worker harmless for counters |
| Counter repair scans every post and user hourly | Run it daily, or only for posts and users touched by purges, at hundreds of thousands of posts |
| Practice stats aggregate every attempt on each request | A per-user, per-topic stats table maintained by the worker, when users have thousands of attempts |
| Random practice questions use `ORDER BY random()` | Sample by id range or `TABLESAMPLE` at tens of thousands of questions |
| Search runs on Postgres | Elasticsearch indexer consuming the existing `search.sync` outbox events |
| No user locale | `users.locale` for Bangla push and email text |
| One DB role with full rights | App role with DML only, migration role with DDL, PgBouncer, backups with point-in-time recovery |
| Large tables | Partition `notifications` and `question_attempts`, and add a read replica, at millions of rows |
