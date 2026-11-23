-- Up Migration

-- Research tab, Group A (docs/prototype-2-implementation-notes.md §2.7). Additions only: the
-- Prototype 2 research tables, columns and endpoints stay as they are.
--
--   A1  papers get scholarly metadata (venue, abstract, ids, citations, Hugging Face upvotes,
--       trend rank, TLDR), filled by the ingestion worker; fields get a chip order.
--   A2  paper_cards (the Paper Card in English and Bangla) and papers.search_vector over title,
--       authors and the card question in both languages, with a 'bangla' search configuration.
--   A3  paper_saves: a bookmark independent of reading progress.
--   A4  reading_passes: the three-step tracker (explored, studied, reproduced) and a private note.
--   A5  research_outputs: saved results of the AI research tools, reopened without AI.
--   A6  paper_edges: citation lineage between papers in the collection, with intent.
--   A7  trails and trail_items: reading paths that users make.
--   A10 papers.pdf_url (papers.paper_url stays the main "Open" link).
--   A13 typed links on paper_prerequisites, user_known_topics, learn_item_completions and
--       posts.topic_id, so "Learn before reading" can tell what is done.
--   Reports can target a trail.

-- ===================== A2: Bangla text search =====================

-- PostgreSQL ships no Bangla stemmer. 'bangla' is the 'simple' configuration (lower-case, no
-- stemming, no stop words) under its own name, so it can be swapped for a real Bangla dictionary
-- later without touching the queries.
CREATE TEXT SEARCH CONFIGURATION bangla (COPY = simple);

-- ===================== A1: topic chips and paper metadata =====================

-- Fields are the topic chips (ML fundamentals → DL → … → Emerging research), shown in this order.
ALTER TABLE fields ADD COLUMN position smallint NOT NULL DEFAULT 0;
UPDATE fields f SET position = r.n FROM (SELECT id, row_number() OVER (ORDER BY name) AS n FROM fields) r WHERE r.id = f.id;

ALTER TABLE papers
  ADD COLUMN abstract        text,
  ADD COLUMN venue           text,                 -- e.g. "NeurIPS 2017"
  ADD COLUMN published_on    date,                 -- publication date; drives the "new" badge
  ADD COLUMN doi             text UNIQUE,          -- lower case, without https://doi.org/
  ADD COLUMN arxiv_id        text UNIQUE,          -- without version, e.g. 1706.03762
  ADD COLUMN openalex_id     text UNIQUE,          -- e.g. W2626778328
  ADD COLUMN s2_id           text UNIQUE,          -- Semantic Scholar paperId
  ADD COLUMN pdf_url         text,
  ADD COLUMN code_url        text,                 -- linked code repository (Hugging Face)
  ADD COLUMN tldr            text,                 -- Semantic Scholar's one-line TLDR (English)
  ADD COLUMN citation_count  integer CHECK (citation_count >= 0),
  ADD COLUMN hf_upvotes      integer CHECK (hf_upvotes >= 0),
  ADD COLUMN hf_trending_at  timestamptz,          -- last day it was on Hugging Face daily papers
  ADD COLUMN trend_rank      integer CHECK (trend_rank > 0), -- 1 = first in the default order
  ADD COLUMN openalex_topics jsonb NOT NULL DEFAULT '[]', -- [{id, name, score}], for staff reference
  ADD COLUMN synced_at       timestamptz,          -- last ingestion attempt; NULL = queued
  ADD COLUMN sync_error      text,
  ADD COLUMN search_vector   tsvector;

-- The default Research order (keyset on the same expression as the query) and the sync queue.
CREATE INDEX papers_trend_idx ON papers ((coalesce(trend_rank, 2147483647)), id) WHERE status = 'published';
CREATE INDEX papers_sync_idx ON papers (synced_at NULLS FIRST, id) WHERE doi IS NOT NULL OR arxiv_id IS NOT NULL;

-- ===================== A2: Paper Cards =====================

CREATE TABLE paper_cards (
  paper_id     bigint NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  lang         text   NOT NULL CHECK (lang IN ('en', 'bn')),
  question     text,                          -- the paper's question; searched
  problem      text,
  key_idea     text,
  method_steps text[] NOT NULL DEFAULT '{}',  -- in order
  findings     text,
  takeaway     text,
  limitations  text,
  glossary     jsonb  NOT NULL DEFAULT '[]',  -- [{"term": "...", "definition": "..."}]
  source       text   NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'ai')),
  updated_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, lang)
);

-- The English card starts from the Prototype 2 summary columns, which stay on papers unchanged.
INSERT INTO paper_cards (paper_id, lang, question, key_idea, method_steps, findings, limitations, created_at, updated_at)
SELECT id, 'en', research_questions[1], main_idea, method_steps, results, limitations, created_at, updated_at
FROM papers
WHERE cardinality(research_questions) > 0 OR main_idea IS NOT NULL OR cardinality(method_steps) > 0
   OR results IS NOT NULL OR limitations IS NOT NULL;

-- One definition of the search document, used by this backfill and by the API and worker
-- (src/db/search.ts calls it in the same transaction as every change to a paper or its cards).
CREATE FUNCTION refresh_paper_search(target bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE papers p SET search_vector =
       setweight(to_tsvector('english', p.title), 'A')
    || setweight(to_tsvector('english', coalesce(p.authors, '')), 'B')
    || setweight(to_tsvector('english', concat_ws(' ', p.main_idea,
         (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en'))), 'C')
    || setweight(to_tsvector('bangla', coalesce(
         (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'bn'), '')), 'C')
  WHERE p.id = target;
$$;
SELECT refresh_paper_search(id) FROM papers;
CREATE INDEX papers_search_idx ON papers USING gin (search_vector);

-- Replaced by papers_search_idx (Prototype 1: to_tsvector('english', title || ' ' || coalesce(main_idea, ''))).
DROP INDEX papers_to_tsvector_idx;

-- ===================== A3 / A4: saves and the reading tracker =====================

CREATE TABLE paper_saves (
  user_id    bigint NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  paper_id   bigint NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id)
);
CREATE INDEX paper_saves_user_idx ON paper_saves (user_id, created_at);  -- Saved list and "Up next"

-- step 0 = not read yet (a note can exist without a step). Each step's time is kept while the
-- step holds, for "explored this month" counts; lowering the step clears the later times.
CREATE TABLE reading_passes (
  user_id       bigint   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  paper_id      bigint   NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  step          smallint NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 3),
  note          text     CHECK (char_length(note) <= 400),  -- private, only the owner reads it
  explored_at   timestamptz,
  studied_at    timestamptz,
  reproduced_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id),
  CHECK ((step >= 1) = (explored_at IS NOT NULL)),
  CHECK ((step >= 2) = (studied_at IS NOT NULL)),
  CHECK ((step >= 3) = (reproduced_at IS NOT NULL))
);
CREATE INDEX reading_passes_read_idx ON reading_passes (user_id, updated_at DESC) WHERE step >= 1;  -- Read list

-- Carry over the Prototype 2 tracker (user_papers stays as it is): every tracked paper was saved;
-- "reading" becomes Explored, "completed" becomes Studied.
INSERT INTO paper_saves (user_id, paper_id, created_at)
SELECT user_id, paper_id, updated_at FROM user_papers;
INSERT INTO reading_passes (user_id, paper_id, step, explored_at, studied_at, created_at, updated_at)
SELECT user_id, paper_id,
       CASE status WHEN 'reading' THEN 1 ELSE 2 END,
       updated_at,
       CASE WHEN status = 'completed' THEN updated_at END,
       updated_at, updated_at
FROM user_papers
WHERE status IN ('reading', 'completed');

-- ===================== A5: saved AI outputs =====================

-- Written by the Group C tools (not built yet). Reopening one reads this row: no AI call.
CREATE TABLE research_outputs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id  uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('reading_map', 'landscape_map', 'roadmap', 'comparison', 'claim_check')),
  title      text NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}',  -- the inputs: topic, paper ids, claim
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_outputs_user_idx ON research_outputs (user_id, created_at DESC);

-- ===================== A6: citation lineage =====================

-- One row per citing → cited pair inside our collection. intent NULL = the source gave no usable
-- intent. Semantic Scholar's own labels are kept in s2_intents; 'contrasting' comes only from staff.
CREATE TABLE paper_edges (
  citing_paper_id bigint  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  cited_paper_id  bigint  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  intent          text    CHECK (intent IN ('background', 'supporting', 'contrasting')),
  s2_intents      text[]  NOT NULL DEFAULT '{}',  -- background · methodology · result
  is_influential  boolean NOT NULL DEFAULT false,
  source          text    NOT NULL CHECK (source IN ('semantic_scholar', 'openalex', 'staff')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (citing_paper_id, cited_paper_id),
  CHECK (citing_paper_id <> cited_paper_id)
);
CREATE INDEX paper_edges_cited_idx ON paper_edges (cited_paper_id);  -- "built on by"

-- ===================== A7: reading paths (trails) =====================

CREATE TABLE trails (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id    uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  creator_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  lang         text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'bn')),
  field_id     bigint REFERENCES fields(id) ON DELETE SET NULL,  -- optional chip
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'removed')),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trails_creator_idx ON trails (creator_id, created_at DESC);
CREATE INDEX trails_published_idx ON trails (created_at DESC, id DESC) WHERE status = 'published';

CREATE TABLE trail_items (
  trail_id bigint   NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  paper_id bigint   NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  note     text     CHECK (char_length(note) <= 280),  -- one line per step
  PRIMARY KEY (trail_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (trail_id, paper_id)
);
CREATE INDEX trail_items_paper_idx ON trail_items (paper_id);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check,
  ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('user', 'post', 'comment', 'trail'));

-- ===================== A13: Learn before reading =====================

-- A typed link from each prerequisite to our own content: a lesson or note (learn item), a quiz,
-- or a reel. At most one. Concept = topic.
ALTER TABLE paper_prerequisites
  ADD COLUMN label         text,  -- shown instead of the topic name when set
  ADD COLUMN why           text,  -- one line: why it matters for this paper
  ADD COLUMN learn_item_id bigint REFERENCES learn_items(id) ON DELETE SET NULL,
  ADD COLUMN quiz_id       bigint REFERENCES quizzes(id)     ON DELETE SET NULL,
  ADD COLUMN reel_post_id  bigint REFERENCES posts(id)       ON DELETE SET NULL,
  ADD COLUMN suggested_by  text NOT NULL DEFAULT 'staff' CHECK (suggested_by IN ('staff', 'ai')),
  ADD CONSTRAINT paper_prerequisites_one_link CHECK (num_nonnulls(learn_item_id, quiz_id, reel_post_id) <= 1);

-- Concept tags on reels (lessons and quizzes already have topic_id).
ALTER TABLE posts ADD COLUMN topic_id bigint REFERENCES topics(id) ON DELETE SET NULL;
CREATE INDEX posts_topic_idx ON posts (topic_id) WHERE topic_id IS NOT NULL;

-- "I already know this"
CREATE TABLE user_known_topics (
  user_id    bigint NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  topic_id   bigint NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

-- The user's completed lessons and notes, wherever they were opened (topic page or course).
CREATE TABLE learn_item_completions (
  user_id       bigint NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  learn_item_id bigint NOT NULL REFERENCES learn_items(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, learn_item_id)
);

-- Down Migration

DROP TABLE learn_item_completions, user_known_topics;
DROP INDEX posts_topic_idx;
ALTER TABLE posts DROP COLUMN topic_id;
ALTER TABLE paper_prerequisites DROP CONSTRAINT paper_prerequisites_one_link,
  DROP COLUMN suggested_by, DROP COLUMN reel_post_id, DROP COLUMN quiz_id, DROP COLUMN learn_item_id,
  DROP COLUMN why, DROP COLUMN label;

DELETE FROM reports WHERE target_type = 'trail';
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check,
  ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('user', 'post', 'comment'));
DROP TABLE trail_items, trails;

DROP TABLE paper_edges, research_outputs, reading_passes, paper_saves;

CREATE INDEX papers_to_tsvector_idx ON papers USING gin (to_tsvector('english', title || ' ' || coalesce(main_idea, '')));
DROP INDEX papers_search_idx;
DROP FUNCTION refresh_paper_search(bigint);
DROP TABLE paper_cards;

DROP INDEX papers_sync_idx, papers_trend_idx;
ALTER TABLE papers
  DROP COLUMN search_vector, DROP COLUMN sync_error, DROP COLUMN synced_at, DROP COLUMN openalex_topics,
  DROP COLUMN trend_rank, DROP COLUMN hf_trending_at, DROP COLUMN hf_upvotes, DROP COLUMN citation_count,
  DROP COLUMN tldr, DROP COLUMN code_url, DROP COLUMN pdf_url, DROP COLUMN s2_id, DROP COLUMN openalex_id,
  DROP COLUMN arxiv_id, DROP COLUMN doi, DROP COLUMN published_on, DROP COLUMN venue, DROP COLUMN abstract;
ALTER TABLE fields DROP COLUMN position;

DROP TEXT SEARCH CONFIGURATION bangla;
