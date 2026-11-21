-- Up Migration

-- Prototype v1 schema (PostgreSQL 14+)
-- Tables are created in dependency order.

CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy search on usernames and topic names

-- ===================== Account & Social =====================

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text,
  bio           text,
  avatar_url    text,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follows (
  follower_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX ON follows (following_id);  -- "who follows me"

CREATE TABLE posts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('text', 'image', 'reel')),
  caption          text,
  media_url        text,
  duration_seconds smallint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'text' OR caption IS NOT NULL),
  CHECK (type = 'text' OR media_url IS NOT NULL),
  CHECK (type <> 'reel' OR duration_seconds BETWEEN 1 AND 90)
);
CREATE INDEX ON posts (user_id, created_at DESC);
CREATE INDEX ON posts (created_at DESC) WHERE type = 'reel';

CREATE TABLE post_likes (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX ON post_likes (post_id);

-- ===================== Shared concepts =====================

CREATE TABLE topics (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name    text NOT NULL UNIQUE,
  summary text  -- shown in Learn first when no learn item exists yet
);

-- ===================== Research =====================

CREATE TABLE fields (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text
);

CREATE TABLE papers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_id           bigint NOT NULL REFERENCES fields(id),
  title              text NOT NULL,
  authors            text,
  year               smallint,
  paper_url          text NOT NULL,
  research_questions text[] NOT NULL DEFAULT '{}',
  main_idea          text,
  data_source        text,
  method_steps       text[] NOT NULL DEFAULT '{}',  -- in display order
  results            text,
  figures            jsonb  NOT NULL DEFAULT '[]',  -- [{"url": "...", "caption": "..."}]
  limitations        text,
  evaluation         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON papers (field_id);

CREATE TABLE paper_prerequisites (  -- "Learn first"
  paper_id bigint   NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  topic_id bigint   NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (paper_id, topic_id)
);

CREATE TABLE roadmap_steps (  -- one starting roadmap per field
  field_id bigint   NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  paper_id bigint   NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  note     text,  -- why this paper comes at this point
  PRIMARY KEY (field_id, position),
  UNIQUE (field_id, paper_id)
);

CREATE TABLE user_papers (  -- saved list + reading tracker
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id   bigint NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'saved'
             CHECK (status IN ('saved', 'reading', 'completed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id)
);

-- ===================== Comments & notifications =====================

CREATE TABLE comments (  -- post comments and paper discussion
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    bigint REFERENCES posts(id)    ON DELETE CASCADE,
  paper_id   bigint REFERENCES papers(id)   ON DELETE CASCADE,
  parent_id  bigint REFERENCES comments(id) ON DELETE CASCADE,  -- replies
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((post_id IS NULL) <> (paper_id IS NULL))  -- exactly one is set
);
CREATE INDEX ON comments (post_id, created_at);
CREATE INDEX ON comments (paper_id, created_at);
CREATE INDEX ON comments (parent_id);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- receives it
  actor_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- caused it
  type       text NOT NULL CHECK (type IN ('follow', 'like', 'comment', 'reply')),
  post_id    bigint REFERENCES posts(id)    ON DELETE CASCADE,
  comment_id bigint REFERENCES comments(id) ON DELETE CASCADE,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);

-- ===================== Learn =====================

CREATE TABLE learn_items (  -- one video, figure/diagram, or text explanation
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_id         bigint REFERENCES topics(id) ON DELETE SET NULL,
  title            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('video', 'image', 'text')),
  media_url        text,
  body             text,
  duration_seconds smallint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'text' OR media_url IS NOT NULL)
);
CREATE INDEX ON learn_items (topic_id);

CREATE TABLE courses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         text NOT NULL,
  description   text,
  thumbnail_url text,
  external_url  text,  -- set for a free outside course; such a course has no items
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_items (
  course_id bigint   NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
  item_id   bigint   NOT NULL REFERENCES learn_items(id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  PRIMARY KEY (course_id, position),
  UNIQUE (course_id, item_id)
);

-- ===================== Practice =====================

CREATE TABLE questions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_id    bigint NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('mcq', 'short')),
  prompt      text NOT NULL,
  options     text[],         -- MCQ choices; NULL for short questions
  answer      text NOT NULL,  -- MCQ: the correct option's text
  explanation text,
  CHECK (kind = 'short' OR (options IS NOT NULL AND cardinality(options) >= 2))
);
CREATE INDEX ON questions (topic_id);

-- ===================== Search indexes =====================
-- Queries must use the same expression to hit these indexes.

CREATE INDEX ON users  USING gin (username gin_trgm_ops);
CREATE INDEX ON topics USING gin (name gin_trgm_ops);
CREATE INDEX ON posts       USING gin (to_tsvector('english', coalesce(caption, '')));
CREATE INDEX ON learn_items USING gin (to_tsvector('english', title || ' ' || coalesce(body, '')));
CREATE INDEX ON courses     USING gin (to_tsvector('english', title || ' ' || coalesce(description, '')));
CREATE INDEX ON papers      USING gin (to_tsvector('english', title || ' ' || coalesce(main_idea, '')));

-- Down Migration

DROP TABLE IF EXISTS
  questions, course_items, courses, learn_items, notifications, comments,
  user_papers, roadmap_steps, paper_prerequisites, papers, fields, topics,
  post_likes, posts, follows, users;
DROP EXTENSION IF EXISTS pg_trgm;
