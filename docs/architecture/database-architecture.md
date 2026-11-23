# Database architecture

Status as of Nov 23, 2026 (Prototype 2 backend plus the Research tab's Group A, after migration `…005`). Source of truth: the SQL files in [`apps/api/migrations/`](../../apps/api/migrations/). Generated TypeScript types: [`apps/api/src/db/types.ts`](../../apps/api/src/db/types.ts). A step-by-step guide to the same schema (a guided tour, then tables by area, then reference pages) is in [`Schema-Explorer.html`](Schema-Explorer.html).

Related: [Backend architecture](backend-architecture.md) · [Implementation notes and decisions](../prototype-2-implementation-notes.md) · [API reference](../../apps/api/README.md)

## Contents

1. [Overview](#1-overview)
2. [Conventions](#2-conventions)
3. [Entity–relationship diagram](#3-entityrelationship-diagram)
4. [Tables by domain](#4-tables-by-domain)
5. [Write paths and efficiency](#5-write-paths-and-efficiency)
6. [The Research tab's data](#6-the-research-tabs-data)
7. [Indexes](#7-indexes)
8. [Integrity rules and delete behaviour](#8-integrity-rules-and-delete-behaviour)
9. [Data lifecycle and retention](#9-data-lifecycle-and-retention)
10. [Migrations](#10-migrations)
11. [Known gaps and planned changes](#11-known-gaps-and-planned-changes)

---

## 1. Overview

| Item | Value |
| --- | --- |
| Engine | PostgreSQL 16+ (tested on 18; works on 13+, `gen_random_uuid()` is built in) |
| Extensions and configurations | `pg_trgm` (fuzzy search on usernames and topic names); text search configuration `bangla` (a copy of `simple`) |
| Tables | 39, in 8 domains |
| Foreign keys | 76: 51 cascade, 22 set null, 3 restrict |
| Functions | `refresh_paper_search(paper_id)`: the one definition of a paper's search document |
| Query layer | Kysely (typed SQL builder), `pg` driver, one connection pool per process |
| Migrations | node-pg-migrate, plain SQL files, each run in its own transaction |
| Statement timeout | `DB_STATEMENT_TIMEOUT_MS` (default 5000 ms) on every pooled connection |
| Databases | `doshomik` (development), `doshomik_test` (wiped and migrated by the test run) |

There is no Redis, Elasticsearch or separate queue. Postgres also serves as:

- the **job queue**: `outbox_events`, `media_assets` rows with `status = 'processing'`, and papers due for ingestion (`papers.synced_at`);
- the **search engine**: `tsvector` GIN and trigram indexes;
- the **audit store**: `audit_log`.

The app never calls a scholarly API. OpenAlex, Semantic Scholar and Hugging Face data is ingested by the worker into `papers` and `paper_edges` ([backend §7.1](backend-architecture.md#71-paper-ingestion-research-tab)); requests read only our tables.

## 2. Conventions

| Convention | Detail |
| --- | --- |
| Internal keys | `id bigint GENERATED ALWAYS AS IDENTITY`. Used for joins only and **never sent to clients**. |
| Public keys | `public_id uuid DEFAULT gen_random_uuid() UNIQUE` on every row a client can name: users, posts, comments, notifications, papers, courses, learn items, questions, quizzes, media assets, sessions, trails and research outputs. |
| Slugs | `topics.slug` and `fields.slug` (`NOT NULL UNIQUE`) name those rows in URLs. |
| Enums | `text` columns with `CHECK (... IN (...))`, not Postgres enum types. They are easier to change in a migration. The same lists are in [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts), so change both together. |
| Timestamps | `timestamptz`. `created_at DEFAULT now()` everywhere; `updated_at` on mutable rows, set by the application, not by triggers. |
| Soft delete | `deleted_at` on `users`, `posts` and `comments`. Rows are hidden at once and purged later (§9). |
| Toggle rows | A relationship whose creation has side effects (a notification, a counter) keeps **one row per pair** and flips a state instead of being deleted and re-inserted: `post_likes.is_active` and `follows.status = 'inactive'`. Only the first activation ever notifies (§5). |
| Stored counters | `posts.like_count`, `posts.comment_count`, `users.follower_count`, `users.following_count`. Moved **±1** by the worker, exactly once per outbox event, and recounted hourly by the repair job (§5). |
| Ingested fields | Paper metadata from outside sources (`citation_count`, `hf_upvotes`, `tldr`, ids) is written only by the worker. Descriptive fields it fills only when empty, so staff edits win (§6.1). |
| Languages | Content that exists per language has a `lang` column, `en` or `bn` (`paper_cards`, `trails`). |
| Publishing workflow | Team content (`papers`, `courses`, `learn_items`, `questions`, `quizzes`) has `status` `draft` → `published` → `archived`. Most also have `published_at`, `created_by` and `updated_by`. User-made trails have `draft` → `published`, and `removed` by a moderator. |
| Storage keys, not URLs | `media_assets` stores `raw_key`, `playback_key` and `thumbnail_key`. URLs are built at read time, so changing storage provider changes no data. |
| Join tables | Composite primary keys, e.g. `follows (follower_id, following_id)`, `reading_passes (user_id, paper_id)`. |
| Ordered children | `position smallint` in the primary key (`course_items`, `roadmap_steps`, `quiz_questions`, `trail_items`), made `DEFERRABLE INITIALLY DEFERRED` so a whole list can be reordered in one transaction. |
| Polymorphic references | `reports.target_id`, `outbox_events.entity_id` and `audit_log.entity_id` have **no foreign key** on purpose: these rows must outlive their targets. |

## 3. Entity–relationship diagram

Keys and relationships only; columns are listed in §4. `||--o{` means one-to-many. `users` is the hub: 37 foreign keys from 29 tables point at it; `papers` is the second hub of the Research tab.

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
    users ||--o{ user_papers : "tracks (Prototype 2)"
    users ||--o{ paper_saves : bookmarks
    users ||--o{ reading_passes : reads
    users ||--o{ research_outputs : "saves AI outputs"
    users ||--o{ trails : creates
    users ||--o{ course_progress : "progresses in"
    users ||--o{ learn_item_completions : completes
    users ||--o{ user_known_topics : "already knows"
    users ||--o{ question_attempts : answers
    users ||--o{ audit_log : "acts in"

    media_assets ||--o{ posts : "media of"
    media_assets ||--o{ learn_items : "media of"

    posts ||--o{ post_likes : ""
    posts ||--o{ saved_posts : ""
    posts ||--o{ comments : ""
    posts ||--o{ notifications : ""
    posts ||--o{ paper_prerequisites : "reel for"
    comments ||--o{ comments : "replies"
    comments ||--o{ notifications : ""

    fields ||--o{ papers : "chip of"
    fields ||--o{ roadmap_steps : "roadmap"
    fields ||--o{ user_fields : ""
    fields ||--o{ trails : "chip of"
    papers ||--o{ paper_cards : "card in en / bn"
    papers ||--o{ paper_edges : "cites / cited by"
    papers ||--o{ roadmap_steps : "step of"
    papers ||--o{ paper_prerequisites : "learn first"
    papers ||--o{ paper_saves : ""
    papers ||--o{ reading_passes : ""
    papers ||--o{ user_papers : ""
    papers ||--o{ trail_items : "step of"
    papers ||--o{ comments : "discussion"
    trails ||--o{ trail_items : ""

    topics ||--o{ paper_prerequisites : "concept"
    topics ||--o{ learn_items : ""
    topics ||--o{ questions : ""
    topics ||--o{ quizzes : ""
    topics ||--o{ posts : "concept tag"
    topics ||--o{ user_known_topics : ""

    courses ||--o{ course_items : ""
    learn_items ||--o{ course_items : "step of"
    learn_items ||--o{ learn_item_completions : ""
    learn_items ||--o{ paper_prerequisites : "lesson or note for"
    courses ||--o{ course_progress : ""

    questions ||--o{ quiz_questions : ""
    quizzes ||--o{ quiz_questions : ""
    quizzes ||--o{ paper_prerequisites : "quiz for"
    questions ||--o{ question_attempts : ""

    outbox_events {
        bigint id PK
        text event_type
        text entity_type
        bigint entity_id "no FK"
    }
```

Not shown: `created_by` and `updated_by` on team content, `paper_cards.updated_by`, and `reports.target_id` (polymorphic, no FK). The full list of foreign keys with their delete rules is in §8 and, filterable, in the [Schema Explorer](Schema-Explorer.html#ref/links).

## 4. Tables by domain

Columns are listed as they are **after all six migrations**. PK = primary key, FK = foreign key, U = unique. Columns added by migration `…004` or `…005` are marked **(004)** or **(005)**.

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
| `reports` | id PK | reporter_id, target_type `user` · `post` · `comment` · `trail` **(005)**, target_id (no FK), reason, details, status `open` · `actioned` · `dismissed`, reviewed_by, reviewed_at | Reasons: `spam`, `harassment`, `nudity`, `violence`, `misinformation`, `other` |

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
| topic_id **(005)** | FK → topics, set null | Optional concept tag, so a reel can be the link of a paper's Learn first topic |
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
| `comments` | id PK, public_id U | Attached to **exactly one** of `post_id` or `paper_id` (CHECK), both cascade. `paper_id` is the paper's discussion thread (A9), which shares reports, blocks, rate limits and moderation with post comments. `parent_id` → comments (cascade) for replies. `user_id` is nullable with `ON DELETE SET NULL`, so threads survive a purged account. `deleted_at` leaves a `[deleted]` placeholder. No `updated_at` |
| `notifications` | id PK, public_id U | `user_id` receives it, `actor_id` caused it (both cascade). Types: `follow`, `follow_request`, `like`, `comment`, `reply`, `post_ready`. Optional `post_id` and `comment_id` (cascade). `is_read`. Written only by the worker |

### 4.5 Learn

| Table | Key | Columns / notes |
| --- | --- | --- |
| `topics` | id PK, name U, slug U | `summary`, shown in "Learn first" when a topic has no learn items yet. A topic is a **concept**: the unit that links lessons, quizzes, reels and paper prerequisites |
| `learn_items` | id PK, public_id U | `topic_id` (set null), `title`, `kind` `video` · `image` · `text`, `body`, `duration_seconds`, `media_url` (outside link) **or** `media_id` (uploaded media, restrict) unless `kind = 'text'`, plus the publishing columns. A video is a *lesson*; text and image items are *notes* |
| `courses` | id PK, public_id U | `title`, `description`, `thumbnail_url`, `external_url` (a free outside course has no items), plus the publishing columns |
| `course_items` | PK (course_id, position) deferrable; U (course_id, item_id) | Ordered steps of a course; both FKs cascade |
| `course_progress` | PK (user_id, course_id) | `last_position`, `completed_at` (first completion kept), `updated_at`. Written with one upsert; it also marks the steps reached in `learn_item_completions` |
| `learn_item_completions` **(005)** | PK (user_id, learn_item_id), both cascade | `completed_at`. The user's completed lessons and notes, wherever they were opened. Feeds "done" in Learn before reading |
| `user_known_topics` **(005)** | PK (user_id, topic_id), both cascade | "I already know this" (the spec's `user_known_concepts`) |

### 4.6 Practice

| Table | Key | Columns / notes |
| --- | --- | --- |
| `questions` | id PK, public_id U | `topic_id` (cascade), `kind` `mcq` · `short`, `prompt`, `options text[]` (≥ 2 for MCQ), `answer`, `explanation`, plus the publishing columns. No `created_at` (inherited from Prototype 1) |
| `question_attempts` | id PK | `user_id`, `question_id`, `answer`, `is_correct`, `created_at`. Append-only history; powers accuracy per topic, streak days (`APP_TIMEZONE`), and "quiz done" in Learn before reading |
| `quizzes` | id PK, public_id U | `title`, `topic_id` (set null), `status`, `created_by` (no `published_at` or `updated_by`) |
| `quiz_questions` | PK (quiz_id, position) deferrable; U (quiz_id, question_id) | |

### 4.7 Research

**`fields`**: the topic chips (ML fundamentals → Deep learning → … → Agents → Emerging research). id PK, name U, slug U, `description`, `position` **(005)** (chip order, smallest first). A field can't be deleted while it has papers.

**`papers`**: the curated collection.

| Column | Type | Notes |
| --- | --- | --- |
| id, public_id | bigint PK, uuid U | |
| field_id | FK → fields, restrict | Its chip (one per paper) |
| title, authors, year | text, text, smallint | `title` is empty for an import until the first sync |
| paper_url | text | The original's abstract page: the main **Open** action (A10). We never host a PDF |
| research_questions, main_idea, data_source, method_steps, results, figures, limitations, evaluation | | The Prototype 2 structured summary, unchanged. The English Paper Card was backfilled from it |
| status, published_at, created_by, updated_by, created_at, updated_at | | Publishing columns |
| abstract, venue **(005)** | text | From OpenAlex, or staff |
| published_on **(005)** | date | Drives the "New" badge (within 30 days) |
| doi, arxiv_id, openalex_id, s2_id **(005)** | text U | Identifiers. DOI lower case without the resolver; arXiv id without version |
| pdf_url, code_url **(005)** | text | Open-access PDF (Semantic Scholar); linked code repository (Hugging Face) |
| tldr **(005)** | text | Semantic Scholar's one-line TLDR (English) |
| citation_count **(005)** | integer | Semantic Scholar, else OpenAlex |
| hf_upvotes, hf_trending_at **(005)** | integer, timestamptz | Upvotes and the last day the paper was on Hugging Face daily papers |
| trend_rank **(005)** | integer | 1..n over published papers: the default order (§6.1) |
| openalex_topics **(005)** | jsonb | `[{id, name, score}]`, for staff reference when choosing the field |
| synced_at, sync_error **(005)** | timestamptz, text | Last ingestion attempt (`NULL` = queued) and its error |
| search_vector **(005)** | tsvector | Title, authors, main idea and both card questions (§6.2) |

| Table | Key | Columns / notes |
| --- | --- | --- |
| `paper_cards` **(005)** | PK (paper_id, lang); paper cascade | The Paper Card per language (`en`, `bn`): `question` (searched), `problem`, `key_idea`, `method_steps text[]`, `findings`, `takeaway`, `limitations`, `glossary jsonb` (`[{term, definition}]`), `source` `staff` · `ai`, `updated_by` (set null) |
| `paper_edges` **(005)** | PK (citing_paper_id, cited_paper_id), both cascade; `CHECK` not self | Citation lineage inside the collection: `intent` `background` · `supporting` · `contrasting` (NULL = unknown), `s2_intents text[]` (Semantic Scholar's own labels), `is_influential`, `source` `semantic_scholar` · `openalex` · `staff` |
| `paper_prerequisites` | PK (paper_id, topic_id), both cascade | "Learn first" concepts with `position`; **(005)** `label`, `why`, a typed link (at most one of `learn_item_id`, `quiz_id`, `reel_post_id`, each set null), `suggested_by` `staff` · `ai` |
| `paper_saves` **(005)** | PK (user_id, paper_id), both cascade | The bookmark. `created_at` orders Saved and picks Up next |
| `reading_passes` **(005)** | PK (user_id, paper_id), both cascade | The three-step tracker: `step` 0–3 (not read, Explored, Studied, Reproduced), `explored_at`, `studied_at`, `reproduced_at` (kept while the step holds), private `note` (≤ 400 characters) |
| `research_outputs` **(005)** | id PK, public_id U; user cascade | Saved AI tool results: `kind` `reading_map` · `landscape_map` · `roadmap` · `comparison` · `claim_check`, `title`, `params jsonb`, `result jsonb`. Reopened without AI |
| `trails` **(005)** | id PK, public_id U; creator cascade | Reading paths users make: `title`, `description`, `lang`, `field_id` (set null), `status` `draft` · `published` · `removed`, `published_at` |
| `trail_items` **(005)** | PK (trail_id, position) deferrable; U (trail_id, paper_id) | Ordered steps, `note` (≤ 280 characters, one line per step); both FKs cascade |
| `roadmap_steps` | PK (field_id, position) deferrable; U (field_id, paper_id) | The team's starting roadmap per field; `note` explains the step |
| `user_papers` | PK (user_id, paper_id) | The Prototype 2 tracker (`saved` · `reading` · `completed`), kept as it was. Superseded by `paper_saves` and `reading_passes`, which were backfilled from it |
| `user_fields` | PK (user_id, field_id) | Interests picked at onboarding. Saving writes only the difference |

### 4.8 System

| Table | Purpose | Notes |
| --- | --- | --- |
| `outbox_events` | Work for the background worker, written **in the same transaction** as the change | `event_type`, `entity_type`, `entity_id`, `payload jsonb`, `attempts`, `processed_at`. The worker claims an event by setting `processed_at` only while it is still NULL (§5). Event types are listed in [backend architecture §6](backend-architecture.md#6-outbox-events) |
| `audit_log` | Every admin and security action | `actor_id` (set null), `action` (e.g. `paper.publish`, `paper.import`, `paper.card`, `paper.edge`, `user.suspend`, `user.purge`), `entity_type`, `entity_id`, `changes jsonb`, `ip inet` |

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

### 5.2 Follows: one row, toggled by status

| Action | Row change | Events |
| --- | --- | --- |
| Follow a public account | insert, or `inactive` → `accepted` | `follow.created` (first follow only) · `follow.changed +1` |
| Request a private account | insert, or `inactive` → `pending` | `follow.created` (first request only) |
| Accept a request; account goes public | `pending` → `accepted` | `follow.changed +1` per follower |
| Unfollow | `accepted` → `inactive` | `follow.changed −1` |
| Withdraw / decline a request | `pending` → `inactive` | none |
| Block (both directions) | live follows → `inactive` | `follow.changed −1` for each accepted one |

### 5.3 Stored counters

| Counter | Moved by | Before `…004` |
| --- | --- | --- |
| `posts.like_count` | `post.liked` +1, `post.unliked` −1 | Recounted all likes **and** all comments of the post on every event |
| `posts.comment_count` | `comment.created` +1, `comment.deleted` −1 | Same recount |
| `users.follower_count`, `following_count` | `follow.changed` ±1 on both users | `COUNT(*)` on every profile view; "people to follow" counted followers for every active user, then sorted |

±1 updates are safe because each event is applied **exactly once**: the worker claims it (`UPDATE outbox_events SET processed_at = now() WHERE id = $1 AND processed_at IS NULL`) and runs its handler in the same transaction. Paths that write no event, mainly account purges, can leave a count off; the hourly `repairCounters` job recounts and fixes any drift.

### 5.4 Other fixes and what was left alone

- **Interests** (`user_fields`): saving writes only the difference.
- **Unread badge**: `notifications_unread_idx (user_id) WHERE NOT is_read`.
- **Redundant index dropped**: the Prototype 1 `posts (created_at DESC) WHERE type = 'reel'`.
- **Left as they are**: `saved_posts` and `paper_saves` (no side effects; a re-save moves to the top, which rewrites the indexed `created_at` anyway), `user_papers`, `course_progress` and `reading_passes` (already one upsert per row), `blocks` (rare), `question_attempts` (append-only history).

## 6. The Research tab's data

How Group A (A1–A7, A9, A10, A13) maps onto the tables. Decisions: [implementation notes §2.7](../prototype-2-implementation-notes.md#27-research-tab-group-a-migration-005-23-nov-2026).

### 6.1 Collection, ingestion and trend order (A1, A10)

```mermaid
flowchart LR
    staff["Staff: import arXiv id / DOI,<br/>write cards, publish"] --> papers[(papers)]
    oa["OpenAlex"] --> worker
    s2["Semantic Scholar"] --> worker
    hf["Hugging Face daily papers"] --> worker
    worker["Worker papers loop"] -->|"metadata, citations,<br/>TLDR, trending"| papers
    worker -->|references| edges[(paper_edges)]
    worker -->|"trend_rank 1..n"| papers
    papers --> api["API: GET /papers<br/>(reads only Postgres)"]
```

| Data | Written by | Rule |
| --- | --- | --- |
| Title, authors, year, venue, abstract, publication date, PDF link | Staff, or the worker when empty | Staff edits win |
| Citation count, TLDR, OpenAlex and S2 ids, OpenAlex topics | Worker, every sync (7 days) | Always refreshed |
| `hf_upvotes`, `hf_trending_at`, `code_url` (if empty) | Worker, every 6 hours | Matched by arXiv id over the last 7 days of daily papers |
| `trend_rank` | Worker after each sync, and hourly maintenance | Trending on Hugging Face in the last 14 days first (most upvotes first), then most cited, then newest. Dense 1..n over published papers |
| "New" badge | Computed | `published_on` within the last 30 days |

`GET /papers` orders by `coalesce(trend_rank, 2147483647), id`, a keyset page on `papers_trend_idx`; the chip filter is `field_id`. The paper's **Open** button is `paper_url` (the arXiv abstract page or the DOI); `pdf_url` and `code_url` are extra links.

### 6.2 Search (A2)

`papers.search_vector` is built by `refresh_paper_search(paper_id)`:

```
setweight(to_tsvector('english', title), 'A')
|| setweight(to_tsvector('english', authors), 'B')
|| setweight(to_tsvector('english', main_idea || ' ' || English card question), 'C')
|| setweight(to_tsvector('bangla',  Bangla card question), 'C')
```

The query is `websearch_to_tsquery('english', q) || websearch_to_tsquery('bangla', q)`, so a Bangla query finds an English-titled paper through its Bangla card. The API calls the function in the same transaction as every change to a paper or its cards, and the worker after every sync. `bangla` is PostgreSQL's `simple` configuration (lower-case, no stemming). How Bangla words are split depends on the server's locale; with a C locale every Bangla letter and sign stays in the word. GIN index: `papers_search_idx`.

### 6.3 Saves, the reading tracker and My papers (A3–A5)

| Screen | Query |
| --- | --- |
| Up next | `paper_saves` ⋈ papers where no `reading_passes` row with `step >= 1`, earliest `created_at` first, limit 1 |
| My papers → Saved | Same condition, newest saved first |
| My papers → Read | `reading_passes` with `step >= 1`, latest `updated_at` first |
| My papers → Maps and roadmaps | `research_outputs` of the user; opening one reads the stored `result` (no AI, no allowance) |
| Profile → Reading | Counts of `explored_at`, `studied_at`, `reproduced_at` this month (`APP_TIMEZONE`) and of `step >= 1/2/3` in total. Private accounts: accepted followers only |

Steps are cumulative: setting step 3 also stamps steps 1 and 2. Lowering the step clears the later times (CHECK constraints keep them consistent), so monthly counts never include a step the user took back. "Mark read" only raises the step to 1. The note is private: it is returned only in the owner's `my_reading`.

### 6.4 Lineage (A6)

`paper_edges` holds a row for every citation between two papers **in our collection**, built from each paper's own references. "Builds on" lists the papers it cites; "built on by" lists the papers citing it, influential first, then most cited, three each by default.

| Intent | From |
| --- | --- |
| `supporting` | Semantic Scholar `methodology` (the citing paper builds on the cited method) |
| `background` | Semantic Scholar `background` |
| NULL (unknown) | Semantic Scholar `result` alone, no intent, or an OpenAlex-only edge |
| `contrasting` | **Staff only** (`PUT /admin/paper-edges`). Semantic Scholar has no such label |

The worker never changes a staff edge's intent. No force-directed graph is stored or drawn.

### 6.5 Trails (A7)

A trail is an ordered list of published papers with one line per step, made by any user. Publishing needs at least 2 papers. A published trail follows its author's visibility like a post (blocks, inactive authors, private accounts), and can be reported; a moderator's `remove_content` sets `status = 'removed'`.

### 6.6 Learn before reading (A13)

Each `paper_prerequisites` row is a concept (`topic_id`) with a `label` (else the topic name), a one-line `why`, and at most one link:

| Link | Shown with | Counts as done when |
| --- | --- | --- |
| `learn_item_id`, video → **lesson** | minutes (media duration) | the item is in `learn_item_completions` |
| `learn_item_id`, text or image → **note** | minutes (words ÷ 200) | the item is in `learn_item_completions` |
| `quiz_id` → **quiz** | question count | every published question in it has a `question_attempts` row from the user |
| `reel_post_id` → **reel** | seconds | only through "I already know this" |
| any, or none | | the topic is in `user_known_topics` |

`done` is always computed, never stored. The response carries `ready` / `total` for the progress ring, and `ai_suggested` when any row has `suggested_by = 'ai'`, so the app shows the disclosure footnote.

## 7. Indexes

Besides primary keys and unique constraints:

| Purpose | Index |
| --- | --- |
| Profile pages and home feed (keyset on `created_at, id`) | `posts_user_feed_idx (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL AND status = 'published'` |
| A user's posts in any status; the user cascade | `posts (user_id, created_at DESC)` |
| Reels list | `posts_reels_idx (created_at DESC, id DESC) WHERE type = 'reel' AND status = 'published' AND deleted_at IS NULL` |
| Posts waiting on a media asset | `posts (media_id)` |
| Reels by concept **(005)** | `posts_topic_idx (topic_id) WHERE topic_id IS NOT NULL` |
| People to follow **(004)** | `users_suggest_idx (follower_count DESC, id DESC) WHERE status = 'active'` |
| Who follows me; the user cascade | `follows (following_id)` |
| Pending follow requests **(004)** | `follows_pending_idx (following_id, updated_at DESC) WHERE status = 'pending'` |
| Block checks from the blocked side | `blocks (blocked_id)` |
| Likes per post (repair job, post cascade) | `post_likes (post_id)` |
| Comments per post and paper; replies | `comments (post_id, created_at)`, `comments (paper_id, created_at)`, `comments (parent_id)` |
| Notifications inbox; unread badge **(004)** | `notifications (user_id, created_at DESC)`, `notifications_unread_idx (user_id) WHERE NOT is_read` |
| Saved posts | `saved_posts (user_id, created_at DESC)` |
| Research collection in trend order **(005)** | `papers_trend_idx ((coalesce(trend_rank, 2147483647)), id) WHERE status = 'published'` |
| Paper search **(005)** | `papers_search_idx` GIN on `search_vector` (replaced the Prototype 1 title + main idea expression index) |
| Papers due for ingestion **(005)** | `papers_sync_idx (synced_at NULLS FIRST, id) WHERE doi IS NOT NULL OR arxiv_id IS NOT NULL` |
| Papers by field; content by topic | `papers (field_id)`, `learn_items (topic_id)`, `questions (topic_id)` |
| "Built on by" **(005)** | `paper_edges_cited_idx (cited_paper_id)` |
| Saved papers and Up next **(005)** | `paper_saves_user_idx (user_id, created_at)` |
| Read list **(005)** | `reading_passes_read_idx (user_id, updated_at DESC) WHERE step >= 1` |
| Saved AI outputs **(005)** | `research_outputs_user_idx (user_id, created_at DESC)` |
| Trails: a creator's list, the public list, trails containing a paper **(005)** | `trails_creator_idx (creator_id, created_at DESC)`, `trails_published_idx (created_at DESC, id DESC) WHERE status = 'published'`, `trail_items_paper_idx (paper_id)` |
| Practice history and stats | `question_attempts (user_id, created_at DESC)` |
| Live sessions | `sessions (user_id) WHERE revoked_at IS NULL` |
| Lookups and cascades by user | `auth_identities (user_id)`, `auth_tokens (user_id)` |
| Media queue | `media_assets (status) WHERE status IN ('uploading', 'processing')`, `media_assets (owner_id)` |
| Outbox queue | `outbox_pending_idx (id) WHERE processed_at IS NULL` |
| Moderation queue | `reports (status, created_at)`, `reports (target_type, target_id)` |
| Audit lookups | `audit_log (entity_type, entity_id)`, `audit_log (actor_id, created_at DESC)` |
| Case-insensitive login | unique `lower(email)`, unique `lower(username)` |
| Fuzzy search | GIN trigram on `users.username` and `topics.name` |
| Full-text search | GIN `to_tsvector('english', …)` on `posts.caption`, `learn_items` (title + body), `courses` (title + description) |

> The full-text expressions in [`src/db/search.ts`](../../apps/api/src/db/search.ts) must match the index expressions **exactly**, or Postgres won't use the indexes. The same goes for partial-index predicates and the trend-rank expression: write the query's condition the way the index states it.

## 8. Integrity rules and delete behaviour

**CHECK constraints**

- **Post media.** `CHECK (type = 'text' OR media_id IS NOT NULL)`. The 90-second reel limit lives in the media worker (`media_assets.duration_ms`), not in a CHECK.
- **Comments target.** `CHECK ((post_id IS NULL) <> (paper_id IS NULL))`.
- **MCQ options.** `CHECK (kind = 'short' OR cardinality(options) >= 2)`.
- **Learn items.** `CHECK (kind = 'text' OR media_url IS NOT NULL OR media_id IS NOT NULL)`.
- **Follow status.** `CHECK (status IN ('accepted', 'pending', 'inactive'))`.
- **Reading steps.** `step BETWEEN 0 AND 3`, and each step's time is set exactly when the step is reached (`(step >= 1) = (explored_at IS NOT NULL)`, likewise for studied and reproduced). Note ≤ 400 characters.
- **Prerequisite link.** `num_nonnulls(learn_item_id, quiz_id, reel_post_id) <= 1`.
- **Edges.** No self-citation; intent and source from fixed lists.
- **Counts.** `citation_count >= 0`, `hf_upvotes >= 0`, `trend_rank > 0`.
- **No self-follow or self-block** (CHECKs).

**Foreign keys by delete rule**

| Rule | Foreign keys |
| --- | --- |
| **cascade** (51): the child row goes with the parent | User-owned rows (`sessions`, `auth_identities`, `auth_tokens`, `follows` ×2, `blocks` ×2, `posts`, `post_likes`, `saved_posts`, `notifications` ×2, `user_papers`, `user_fields`, `course_progress`, `question_attempts`, `paper_saves`, `reading_passes`, `research_outputs`, `trails`, `user_known_topics`, `learn_item_completions`); post children (`post_likes`, `saved_posts`, `comments`, `notifications`); paper children (`paper_cards`, `paper_edges` ×2, `paper_saves`, `reading_passes`, `trail_items`, `user_papers`, `paper_prerequisites`, `roadmap_steps`, `comments`); ordered children (`course_items` ×2, `quiz_questions` ×2, `roadmap_steps.field_id`, `trail_items.trail_id`, `paper_prerequisites.topic_id`); `comments.parent_id`, `notifications.comment_id`, `questions.topic_id`, `question_attempts.question_id`, `course_progress.course_id`, `user_fields.field_id`, `user_known_topics.topic_id`, `learn_item_completions.learn_item_id` |
| **set null** (22): the row survives, the link is forgotten | `comments.user_id`, `media_assets.owner_id`, `reports.reporter_id`/`reviewed_by`, `audit_log.actor_id`, `created_by`/`updated_by` on papers, courses, learn items and questions, `quizzes.created_by`, `paper_cards.updated_by`, `learn_items.topic_id`, `quizzes.topic_id`, `posts.topic_id`, `trails.field_id`, `paper_prerequisites.learn_item_id`/`quiz_id`/`reel_post_id` |
| **restrict** (3, `NO ACTION`): delete refused while referenced → `409 IN_USE` | `posts.media_id`, `learn_items.media_id` → `media_assets`; `papers.field_id` → `fields` |

Deleting a user therefore removes their posts (and everything hanging off them), likes, saves, follows, blocks, sessions, identities, codes, progress, attempts, notifications, reading passes, saved outputs and trails. Comments, reports, media ownership, audit entries and `created_by`/`updated_by` are **set null** instead.

**Constraint errors become API errors.** Unique → `409 ALREADY_EXISTS`; FK still referenced → `409 IN_USE`; missing FK target → `400 INVALID_REFERENCE`; CHECK / NOT NULL / bad format → `400 INVALID_DATA` ([`src/lib/error-handler.ts`](../../apps/api/src/lib/error-handler.ts)).

## 9. Data lifecycle and retention

The worker's hourly maintenance ([`src/worker/maintenance.ts`](../../apps/api/src/worker/maintenance.ts)) enforces these. Every job can safely run more than once.

| Data | Rule |
| --- | --- |
| Deleted accounts | `status = 'deleted'` hides them at once. After `ACCOUNT_PURGE_DAYS` (30): their comments are blanked into `[deleted]` placeholders, the user row is deleted (cascading), their post and avatar media rows and files are removed, and a `user.purge` audit entry is written |
| Deleted posts | Hidden at once; after 30 days the row and its media are deleted |
| Stored counters | Post like/comment counts and user follower/following counts recounted wherever they drifted |
| Research order | `trend_rank` recomputed hourly (and after each ingestion round) |
| Paper metadata | Refreshed from the sources every 7 days per paper; a failed sync keeps its error and is retried after 7 days or on "sync now" |
| Inactive likes and follows | Kept: they are what prevents re-notification. Removed with the user or post |
| Reading passes, saves, outputs, trails | Kept until the user (or the paper) is deleted |
| Abandoned uploads | `uploading` or `failed` assets older than 1 day that no post or learn item uses |
| Sessions | Expired or revoked more than 30 days ago |
| Email codes | Expired or used more than 7 days ago |
| Outbox events | Processed more than 30 days ago. Events with `attempts >= 10` stay for inspection (dead letters) |
| Raw uploads | Deleted as soon as processing ends, success or failure (they contain GPS and camera metadata) |

## 10. Migrations

| File | What it does |
| --- | --- |
| `1795305600000_prototype-v1-schema.sql` | The Prototype 1 schema: 16 tables, `pg_trgm`, search indexes |
| `1795305600001_prototype-2.sql` | The Prototype 2 appendix SQL, unchanged except without its `BEGIN`/`COMMIT`: public ids, slugs, user status and privacy, `media_assets`, the publishing workflow, auth tables, safety tables, new feature tables, outbox and audit (14 new tables) |
| `1795305600002_prototype-2-backfill.sql` | Generates slugs and sets them `NOT NULL`; moves Prototype 1 post media into `media_assets` (`provider = 'legacy'`); drops `posts.media_url` and `duration_seconds`; relaxes the learn item media check |
| `1795305600003_sessions-public-id-and-2fa.sql` | `sessions.public_id`, `users.totp_secret` and `totp_enabled_at`, and four indexes for the feed, reels, saves and follow requests |
| `1795305600004_toggles-and-stored-counts.sql` | Toggle rows for likes and follows, stored follow counts, the unread and suggestion indexes; drops the redundant Prototype 1 reels index |
| `1795305600005_research-collection.sql` | Research tab Group A: the `bangla` configuration; `fields.position`; paper metadata and `search_vector` with `refresh_paper_search()`; `paper_cards` (English backfilled), `paper_saves` and `reading_passes` (backfilled from `user_papers`), `research_outputs`, `paper_edges`, `trails`, `trail_items`; prerequisite links, `posts.topic_id`, `user_known_topics`, `learn_item_completions`; trails in reports. 9 new tables |

Rules:

- **Never edit a migration that has been applied.** Add a new one. The project skill [`.claude/skills/doshomik-migration`](../../.claude/skills/doshomik-migration/SKILL.md) has the checklist.
- Every migration has a working `-- Down Migration`, checked with up → down → up. The `…002` down migration loses data for Prototype 2 uploads; `…004` and `…005` down migrations drop what didn't exist before them (inactive likes and follows; trails, passes, cards, edges).
- After changing the schema, run `pnpm db:types` to regenerate `src/db/types.ts`, and update the enum lists in `packages/shared` if a CHECK changed.

## 11. Known gaps and planned changes

Details and steps are in [the implementation notes](../prototype-2-implementation-notes.md) §3–4.

| Gap | Plan |
| --- | --- |
| Random UUIDv4 public ids | Switch defaults to `uuidv7()` once production is on PostgreSQL 18 (better index locality) |
| One worker only (advisory lock) | Add `locked_until` lease columns to `outbox_events` and `media_assets`, then claim rows with `FOR UPDATE SKIP LOCKED`. The claim step already makes a second worker harmless for counters |
| Counter repair scans every post and user hourly | Run it daily, or only for posts and users touched by purges, at hundreds of thousands of posts |
| `user_papers` and `/papers/:id/status` duplicate the new tracker | Drop them once no client uses the Prototype 2 endpoints |
| Bangla search is unstemmed | Give the `bangla` configuration a Hunspell or custom dictionary; queries stay the same |
| No discovery queue for new papers | A `paper_candidates` table filled from Hugging Face daily papers, reviewed by staff |
| Contrasting citations only by hand | A source with citation stances, if one becomes affordable |
| Comment upvotes on paper discussion | `comment_votes` plus a stored `upvote_count`, with Paper Clubs (A15) |
| Research Groups B and C | They write `paper_cards` (`source = 'ai'`), `paper_prerequisites` (`suggested_by = 'ai'`) and `research_outputs` |
| Practice stats aggregate every attempt on each request | A per-user, per-topic stats table maintained by the worker, when users have thousands of attempts |
| Random practice questions use `ORDER BY random()` | Sample by id range or `TABLESAMPLE` at tens of thousands of questions |
| Search runs on Postgres | Elasticsearch indexer consuming the existing `search.sync` outbox events |
| No user locale | `users.locale` for Bangla push and email text, and a default content language |
| One DB role with full rights | App role with DML only, migration role with DDL, PgBouncer, backups with point-in-time recovery |
| Large tables | Partition `notifications` and `question_attempts`, and add a read replica, at millions of rows |
