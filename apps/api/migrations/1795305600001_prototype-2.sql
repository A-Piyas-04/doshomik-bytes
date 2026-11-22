-- Up Migration

-- The Prototype 2 appendix SQL from docs/Prototype 2 — Features, Database, Security & Efficiency.md,
-- unchanged except that its BEGIN and COMMIT are removed: node-pg-migrate already runs each
-- migration in a transaction.

-- Prototype 2 migration: run on top of the Prototype 1 schema.
-- Tested on PostgreSQL 16. On PostgreSQL 18, swap gen_random_uuid() for uuidv7()
-- (time-ordered IDs index better), or generate UUIDv7 in the app.


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


-- Down Migration

DROP TABLE IF EXISTS audit_log, outbox_events, quiz_questions, quizzes, question_attempts, course_progress,
  user_fields, saved_posts, reports, blocks, auth_tokens, sessions, auth_identities;

ALTER TABLE roadmap_steps DROP CONSTRAINT roadmap_steps_pkey, ADD CONSTRAINT roadmap_steps_pkey PRIMARY KEY (field_id, position);
ALTER TABLE course_items  DROP CONSTRAINT course_items_pkey,  ADD CONSTRAINT course_items_pkey  PRIMARY KEY (course_id, position);

ALTER TABLE questions   DROP COLUMN status, DROP COLUMN published_at, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN updated_at;
ALTER TABLE learn_items DROP COLUMN status, DROP COLUMN published_at, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN updated_at, DROP COLUMN media_id;
ALTER TABLE courses     DROP COLUMN status, DROP COLUMN published_at, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN updated_at;
ALTER TABLE papers      DROP COLUMN status, DROP COLUMN published_at, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN updated_at;

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check CHECK (type IN ('follow', 'like', 'comment', 'reply'));

ALTER TABLE comments DROP CONSTRAINT comments_user_id_fkey,
  ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE comments ALTER COLUMN user_id SET NOT NULL, DROP COLUMN deleted_at;

DROP INDEX posts_user_feed_idx;
ALTER TABLE posts DROP COLUMN media_id, DROP COLUMN status, DROP COLUMN like_count, DROP COLUMN comment_count,
  DROP COLUMN updated_at, DROP COLUMN deleted_at;
DROP TABLE media_assets;

ALTER TABLE follows DROP COLUMN status;

DROP INDEX users_email_lower_key, users_username_lower_key;
ALTER TABLE users DROP CONSTRAINT users_role_check,
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL,
  DROP COLUMN status, DROP COLUMN is_private, DROP COLUMN email_verified_at, DROP COLUMN updated_at, DROP COLUMN deleted_at;

ALTER TABLE topics DROP COLUMN slug;
ALTER TABLE fields DROP COLUMN slug;
ALTER TABLE users DROP COLUMN public_id;
ALTER TABLE posts DROP COLUMN public_id;
ALTER TABLE comments DROP COLUMN public_id;
ALTER TABLE notifications DROP COLUMN public_id;
ALTER TABLE papers DROP COLUMN public_id;
ALTER TABLE courses DROP COLUMN public_id;
ALTER TABLE learn_items DROP COLUMN public_id;
ALTER TABLE questions DROP COLUMN public_id;
