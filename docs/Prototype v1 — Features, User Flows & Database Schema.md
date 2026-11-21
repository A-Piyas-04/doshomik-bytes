# Prototype v1 — Features, User Flows & Database Schema

Nov 22, 2026 · @Doshomik

## Overview

Prototype v1 runs on one PostgreSQL database with 16 tables across four areas: Social, Learn, Practice and Research. Everything users create hangs off `users`; everything the team creates (courses, videos, questions, papers) is tied together by `topics`.

Rules that keep v1 small:

- One media file per post, no carousels yet. Reels are capped at 90 seconds.
- Paper sections that are lists (research questions, method steps, figures) live inside the `papers` row as arrays, because they are always read together.
- One `comments` table serves both post comments and paper discussions.
- One starting roadmap per research field.
- Media files live in object storage (S3, Cloudflare R2 or similar). The database keeps only the URL.
- Admins are ordinary users with `role = 'admin'`. They create courses, learn items, questions, papers and roadmaps.

## V1 feature list

**Account and profile**

- Sign up and log in with email, username and password.
- Edit profile: display name, bio, avatar.
- Profile page shows posts, follower and following counts.

**Social**

- Create a post: text only, one image, or one reel (up to 90 seconds).
- Home feed: posts from people you follow, newest first.
- Reels page: reels only, in a scrolling viewer.
- Like and comment on posts, reply to comments.
- Follow and unfollow users.

**Learn**

- Learn items: a single short video, figure or diagram, or text explanation, each tagged with one topic.
- Courses: an ordered set of learn items, made by the team.
- External courses: a card linking to a free outside course (Udemy and similar).
- A learn item can stand alone and also sit inside one or more courses.

**Practice**

- MCQ and short-answer questions, each tagged with a topic.
- Pick a topic, or get random questions. Answer, then see the correct answer and explanation.

**Research**

- Paper list (about 50 at launch), filter by field, search.
- Paper page: original link, research questions, main idea, data source, step-by-step method, results, figures, limitations, evaluation.
- Learn first: the topics to know before reading, with our videos where we have them.
- Save a paper, and track it as saved, reading or completed.
- Starting roadmap: pick a field and get papers in reading order.
- Discussion under each paper, with replies.

**Across the app**

- Notifications for follows, likes, comments and replies.
- One search box covering users, posts, topics, learn items, courses and papers.

## User flows

The app has five tabs: Home, Reels, Learn, Practice and Research, plus Search, Notifications and Profile in the header.

**Sign up**

1. Open the app and choose Sign up.
2. Enter email, username and password.
3. Land on Home. With no follows yet, Home suggests people to follow and points to Learn and Research.

**Create a post**

1. Tap Create and choose Text, Image or Reel.
2. Pick the file (a reel longer than 90 seconds is rejected) and add a caption.
3. Post. It appears on your profile and in your followers' Home feeds; reels also appear on the Reels page.

**Find and follow someone**

1. Search a name or username.
2. Open their profile and tap Follow.
3. They get a notification, and their posts start showing on your Home feed.

**Learn a topic**

1. Open Learn, browse courses or search a topic (for example, ChatGPT).
2. Open a single learn item to watch or read it on its own, or open a course.
3. In a course, go step by step through its items in order.
4. An external course opens its outside link.

**Practice**

1. Open Practice and pick a topic, or choose Random.
2. Answer an MCQ or short question.
3. See whether you were right, the correct answer, and the explanation. Go to the next question.

**Read a paper**

1. Open Research, filter by field or search.
2. Open a paper to see the short summary: research questions, main idea, data, method steps, results, figures, limitations, evaluation, and the link to the original.
3. Tap Learn first to see the topics to know beforehand. Topics we have videos for show them; the rest show the topic name and a short note.
4. Tap Save to wishlist it, then mark it Reading and later Completed. Your profile shows the tracker.
5. Scroll to Discussion to comment, ask for help or reply to others.

**Follow a starting roadmap**

1. In Research, tap Starting roadmap.
2. Pick a field, such as Machine Learning.
3. See the papers in reading order, each with a one-line note on why it comes here.
4. Open any paper and continue with the Read a paper flow.

**Notifications**

1. Someone follows you, likes your post, comments on your post, or replies to your comment.
2. The bell shows an unread count. Opening a notification takes you to the post, comment or profile and marks it read.

## Database overview

All 16 tables hang off `users` or `topics`: users own the social and tracking rows, and topics connect Learn and Practice to Research.

&#91;embedded content: entity-relationship diagram · 16 tables\]

Arrows run from a foreign key to the table it references. A paper reaches its videos through `paper_prerequisites` → `topics` ← `learn_items`, so adding a video for a topic makes it show up in every paper that lists that topic.

## Table definitions

Every `id` is a `bigint` identity column, and every user-owned row is deleted with its user (`ON DELETE CASCADE`). Join tables use a composite primary key instead of an `id`. Exact types and checks are in the appendix.

| Area | Table | Holds | Columns | Primary key · foreign keys |
| --- | --- | --- | --- | --- |
| Account | `users` | Accounts and profiles | id, username, email, password\_hash, display\_name, bio, avatar\_url, role, created\_at | PK id · username and email unique |
| Social | `follows` | Who follows whom | follower\_id, following\_id, created\_at | PK (follower\_id, following\_id) · both → users |
| Social | `posts` | Text, image or reel posts | id, user\_id, type, caption, media\_url, duration\_seconds, created\_at | PK id · user\_id → users |
| Social | `post_likes` | Likes | user\_id, post\_id, created\_at | PK (user\_id, post\_id) · → users, → posts |
| Social | `comments` | Post comments and paper discussion | id, user\_id, post\_id, paper\_id, parent\_id, body, created\_at | PK id · → users, → posts, → papers, parent\_id → comments. Exactly one of post\_id or paper\_id is set |
| Social | `notifications` | Alerts for one user | id, user\_id, actor\_id, type, post\_id, comment\_id, is\_read, created\_at | PK id · user\_id and actor\_id → users, → posts, → comments |
| Learn | `topics` | Concepts shared across the app | id, name, summary | PK id · name unique |
| Learn | `learn_items` | One video, figure or text | id, topic\_id, title, kind, media\_url, body, duration\_seconds, created\_at | PK id · topic\_id → topics |
| Learn | `courses` | Our courses and external course links | id, title, description, thumbnail\_url, external\_url, created\_at | PK id |
| Learn | `course_items` | Which item sits at which step of a course | course\_id, item\_id, position | PK (course\_id, position) · → courses, → learn\_items · (course\_id, item\_id) unique |
| Practice | `questions` | MCQ and short questions | id, topic\_id, kind, prompt, options, answer, explanation | PK id · topic\_id → topics |
| Research | `fields` | Research areas: ML, DL, CV, LLM… | id, name, description | PK id · name unique |
| Research | `papers` | The summarised papers | id, field\_id, title, authors, year, paper\_url, research\_questions, main\_idea, data\_source, method\_steps, results, figures, limitations, evaluation, created\_at | PK id · field\_id → fields |
| Research | `paper_prerequisites` | Learn first topics for a paper | paper\_id, topic\_id, position | PK (paper\_id, topic\_id) · → papers, → topics |
| Research | `roadmap_steps` | A field's starting roadmap | field\_id, position, paper\_id, note | PK (field\_id, position) · → fields, → papers · (field\_id, paper\_id) unique |
| Research | `user_papers` | Saved list and reading tracker | user\_id, paper\_id, status, updated\_at | PK (user\_id, paper\_id) · → users, → papers |

Value lists, enforced with `CHECK`:

- `users.role`: user, admin
- `posts.type`: text, image, reel. Reels need `duration_seconds` of 1 to 90; image and reel posts need a `media_url`.
- `learn_items.kind`: video, image (figures, diagrams, flowcharts), text
- `questions.kind`: mcq, short. MCQ rows need at least two `options`; `answer` holds the correct option's text.
- `notifications.type`: follow, like, comment, reply
- `user_papers.status`: saved, reading, completed

Three columns hold lists rather than child tables: `papers.research_questions` and `papers.method_steps` are `text[]` in display order, and `papers.figures` is `jsonb` holding `[{"url": "…", "caption": "…"}]`.

## How the key features work on this schema

**Learn first.** A paper lists its topics in `paper_prerequisites`. The app joins each topic to the `learn_items` tagged with it. Topics with matching items show the videos; topics without any (item columns come back `NULL`) show only the topic name and its `summary`. That gives the "we have 3 of the 5 videos" behaviour with no extra table.

```sql
SELECT t.name, t.summary, li.id AS item_id, li.title, li.kind, li.media_url
FROM paper_prerequisites pp
JOIN topics t ON t.id = pp.topic_id
LEFT JOIN learn_items li ON li.topic_id = t.id
WHERE pp.paper_id = $1
ORDER BY pp.position, li.id;
```

**One video, many places.** The ChatGPT video is one row in `learn_items`. It is searchable and playable on its own, and `course_items` places it at, say, step 3 of the LLM course. Putting it in another course is one more `course_items` row, not a copy of the video.

**Home feed and Reels.** Home is posts by people you follow, newest first. Reels is `posts` where `type = 'reel'`, which has its own index.

```sql
SELECT p.*
FROM posts p
JOIN follows f ON f.following_id = p.user_id
WHERE f.follower_id = $1
ORDER BY p.created_at DESC
LIMIT 20;
```

**Starting roadmap.** `roadmap_steps` for a field, ordered by `position`. A roadmap may include papers from other fields: an LLM roadmap can start with a deep learning paper.

**Tracker and saved list.** One `user_papers` row per user and paper. Save inserts it as `saved`; the tracker moves it to `reading`, then `completed`. The profile groups a user's rows by status.

**Discussion.** Paper discussion is `comments` with `paper_id` set; post comments have `post_id` set. Replies point at their parent through `parent_id`.

**Notifications.** The app inserts a row when someone follows, likes, comments or replies. The unread count is `is_read = false` for the user.

**Search.** One search endpoint queries each table and returns results grouped by type: users, posts, topics, learn items, courses, papers. v1 uses Postgres itself: full-text indexes on titles, captions and paper summaries, and trigram indexes (`pg_trgm`) on usernames and topic names so typos still match. A separate search engine can come later if needed.

## Left out of v1

Each of these is a new table or column added later, without changing what v1 already has.

| Left out | Why it can wait | How to add it |
| --- | --- | --- |
| Course progress | Courses are short; users can scroll back | `course_progress (user_id, course_id, last_position)` |
| Practice history and scores | Practice works without remembering answers | `question_attempts (user_id, question_id, answer, is_correct, created_at)` |
| Named quizzes | A quiz is "questions on a topic" for now | `quizzes` plus `quiz_questions (quiz_id, question_id, position)` |
| Several images per post | One media file covers image and reel posts | `post_media (post_id, position, url, kind)`; move `media_url` there |
| Several roadmaps per field (beginner, advanced) | One path per field is enough to test the idea | `roadmaps` table; `roadmap_steps` points to it instead of `fields` |
| A paper in several fields | Each paper has one main field | `paper_fields (paper_id, field_id)` |
| An item covering several topics | One topic per item keeps tagging simple | `learn_item_topics (item_id, topic_id)` |
| Saved posts, blocking, reporting, hashtags, messages, view counts | Not needed to prove the core | One small table each, when needed |
| Email verification, password reset, sessions | Can start with a hosted auth service | Follow that service's tables |

When expanding, course progress and practice history are the most likely first additions, since they make the profile show learning progress.

## Appendix: PostgreSQL script

Tested on PostgreSQL 16. It creates all 16 tables in dependency order and rejects bad rows such as a 120-second reel, a comment attached to nothing, or a self-follow.

```sql
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
```
