-- Up Migration

-- Database refactoring (docs/database-refactoring-report.md, notes §2.9).
--
--   1. blocks: unblocking sets is_active = false instead of deleting the row, and blocking again
--      reactivates it, like post_likes and follows (migration 004). created_at stays the first
--      block; updated_at is when the current state began. Neither column is indexed, so a toggle
--      is a HOT update.
--   2. papers is split by responsibility. papers keeps what the team writes about the paper itself;
--      three one-to-one companions (paper_id is the primary key and cascades) take the rest:
--        paper_metadata  outside identifiers and data from OpenAlex and Semantic Scholar
--        paper_metrics   popularity and the Research order
--        paper_sync      the ingestion queue
--      The old partial indexes on papers move to the companion that holds their columns.
--   3. paper_cards becomes the only home of the structured explanation. The Prototype 1/2 summary
--      columns on papers move into the English card (four columns are added for content that had
--      no equivalent), then are dropped. Where a card and the old summary disagree, the losing
--      text is kept in audit_log (action 'paper.summary_migration') instead of being discarded.
--   4. refresh_paper_search() reads the cards' questions and key idea in both languages instead of
--      papers.main_idea, and every search document is rebuilt.
--
-- Paper ids, public ids and every other table's reference to papers(id) are unchanged. Reports'
-- polymorphic target (no foreign key on purpose) is unchanged; the API validates targets.

-- ===================== 1. Block toggle =====================

ALTER TABLE blocks
  ADD COLUMN is_active  boolean     NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE blocks SET updated_at = created_at;  -- every existing block is active and began then

-- ===================== 2. Paper companions =====================

CREATE TABLE paper_metadata (
  paper_id        bigint PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  doi             text UNIQUE,                    -- lower case, without https://doi.org/
  arxiv_id        text UNIQUE,                    -- without version, e.g. 1706.03762
  openalex_id     text UNIQUE,                    -- e.g. W2626778328
  s2_id           text UNIQUE,                    -- Semantic Scholar paperId
  openalex_topics jsonb NOT NULL DEFAULT '[]',    -- [{id, name, score}], for staff reference
  tldr            text                            -- Semantic Scholar's one-line TLDR (English)
);

CREATE TABLE paper_metrics (
  paper_id       bigint PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  citation_count integer CHECK (citation_count >= 0),
  hf_upvotes     integer CHECK (hf_upvotes >= 0),
  hf_trending_at timestamptz,                     -- last day it was on Hugging Face daily papers
  trend_rank     integer CHECK (trend_rank > 0)   -- 1 = first in the default order; NULL = unranked
);

CREATE TABLE paper_sync (
  paper_id   bigint PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  synced_at  timestamptz,                         -- last ingestion attempt; NULL = queued
  sync_error text
);

-- Every paper gets its three rows (the API creates them with the paper from now on).
INSERT INTO paper_metadata (paper_id, doi, arxiv_id, openalex_id, s2_id, openalex_topics, tldr)
SELECT id, doi, arxiv_id, openalex_id, s2_id, openalex_topics, tldr FROM papers;
INSERT INTO paper_metrics (paper_id, citation_count, hf_upvotes, hf_trending_at, trend_rank)
SELECT id, citation_count, hf_upvotes, hf_trending_at, trend_rank FROM papers;
INSERT INTO paper_sync (paper_id, synced_at, sync_error)
SELECT id, synced_at, sync_error FROM papers;

-- The default Research order. Was papers_trend_idx (… WHERE status = 'published'); status stays on
-- papers, so the partial predicate can't follow. The worker clears trend_rank on unpublished
-- papers, and the query joins papers for status. Keyset on the same expression as the query.
CREATE INDEX paper_metrics_trend_idx ON paper_metrics ((coalesce(trend_rank, 2147483647)), paper_id);

-- The ingestion queue: never synced first, then the stalest. Was papers_sync_idx (… WHERE doi IS
-- NOT NULL OR arxiv_id IS NOT NULL); the identifiers are now in paper_metadata, so the query
-- checks them through the primary key join instead.
CREATE INDEX paper_sync_due_idx ON paper_sync (synced_at NULLS FIRST, paper_id);

-- ===================== 3. Paper Cards hold the whole explanation =====================

-- Content the old summary had and the card did not.
ALTER TABLE paper_cards
  ADD COLUMN extra_questions text[] NOT NULL DEFAULT '{}',  -- research questions after `question`, in order
  ADD COLUMN data_source     text,                          -- the data or benchmarks the paper uses
  ADD COLUMN evaluation      text,                          -- how the results were measured
  ADD COLUMN figures         jsonb  NOT NULL DEFAULT '[]';  -- [{"url": "...", "caption": "..."}]

-- Old summary → English card:
--   research_questions[1] → question, research_questions[2:] → extra_questions,
--   main_idea → key_idea, results → findings, and data_source, method_steps, figures,
--   limitations, evaluation to the columns of the same name.
--
-- Which side wins where both have text: a card someone edited (updated_by set, or written by AI)
-- wins over the old summary. A card nobody edited is the copy migration 005 made, and the
-- summary columns kept being edited after that (PATCH /admin/papers), so the summary wins.
-- Empty card fields are always filled, and the losing text is archived first.
CREATE TEMPORARY TABLE summary_merge AS
SELECT p.id AS paper_id,
       (c.updated_by IS NOT NULL OR c.source = 'ai') AS card_wins,
       p.research_questions AS s_questions,
       nullif(c.question, '') AS c_question,    nullif(p.research_questions[1], '') AS s_question,
       nullif(c.key_idea, '') AS c_key_idea,    nullif(p.main_idea, '')             AS s_key_idea,
       c.method_steps   AS c_method_steps, p.method_steps                      AS s_method_steps,
       nullif(c.findings, '') AS c_findings,    nullif(p.results, '')               AS s_findings,
       nullif(c.limitations, '') AS c_limitations, nullif(p.limitations, '')           AS s_limitations
FROM papers p
JOIN paper_cards c ON c.paper_id = p.id AND c.lang = 'en';

INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changes)
SELECT NULL, 'paper.summary_migration', 'paper', paper_id,
       jsonb_build_object('kept', CASE WHEN card_wins THEN 'card' ELSE 'summary' END, 'replaced', replaced)
FROM (
  SELECT paper_id, card_wins, jsonb_strip_nulls(jsonb_build_object(
    'question',     CASE WHEN c_question    <> s_question    THEN to_jsonb(CASE WHEN card_wins THEN s_question    ELSE c_question    END) END,
    -- When the card's question wins, extra_questions still come from the summary: keep the whole
    -- original list, so it is clear which first question they followed.
    'research_questions', CASE WHEN card_wins AND c_question <> s_question AND cardinality(s_questions) > 1 THEN to_jsonb(s_questions) END,
    'key_idea',     CASE WHEN c_key_idea    <> s_key_idea    THEN to_jsonb(CASE WHEN card_wins THEN s_key_idea    ELSE c_key_idea    END) END,
    'findings',     CASE WHEN c_findings    <> s_findings    THEN to_jsonb(CASE WHEN card_wins THEN s_findings    ELSE c_findings    END) END,
    'limitations',  CASE WHEN c_limitations <> s_limitations THEN to_jsonb(CASE WHEN card_wins THEN s_limitations ELSE c_limitations END) END,
    'method_steps', CASE WHEN cardinality(c_method_steps) > 0 AND cardinality(s_method_steps) > 0 AND c_method_steps <> s_method_steps
                         THEN to_jsonb(CASE WHEN card_wins THEN s_method_steps ELSE c_method_steps END) END
  )) AS replaced
  FROM summary_merge
) conflicts
WHERE replaced <> '{}'::jsonb;

UPDATE paper_cards c SET
  question     = CASE WHEN m.card_wins THEN coalesce(m.c_question, m.s_question)       ELSE coalesce(m.s_question, m.c_question) END,
  key_idea     = CASE WHEN m.card_wins THEN coalesce(m.c_key_idea, m.s_key_idea)       ELSE coalesce(m.s_key_idea, m.c_key_idea) END,
  findings     = CASE WHEN m.card_wins THEN coalesce(m.c_findings, m.s_findings)       ELSE coalesce(m.s_findings, m.c_findings) END,
  limitations  = CASE WHEN m.card_wins THEN coalesce(m.c_limitations, m.s_limitations) ELSE coalesce(m.s_limitations, m.c_limitations) END,
  method_steps = CASE WHEN cardinality(m.c_method_steps) = 0 THEN m.s_method_steps
                      WHEN cardinality(m.s_method_steps) = 0 OR m.card_wins THEN m.c_method_steps
                      ELSE m.s_method_steps END,
  extra_questions = p.research_questions[2:],
  data_source     = p.data_source,
  evaluation      = p.evaluation,
  figures         = p.figures
FROM summary_merge m
JOIN papers p ON p.id = m.paper_id
WHERE c.paper_id = m.paper_id AND c.lang = 'en';

-- Papers with a summary but no English card yet (made after migration 005 through the API).
INSERT INTO paper_cards (paper_id, lang, question, extra_questions, key_idea, data_source, method_steps,
                         findings, figures, limitations, evaluation, updated_by, created_at, updated_at)
SELECT p.id, 'en', nullif(p.research_questions[1], ''), p.research_questions[2:], p.main_idea, p.data_source,
       p.method_steps, p.results, p.figures, p.limitations, p.evaluation, p.updated_by, p.created_at, p.updated_at
FROM papers p
WHERE NOT EXISTS (SELECT 1 FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en')
  AND (cardinality(p.research_questions) > 0 OR p.main_idea IS NOT NULL OR p.data_source IS NOT NULL
       OR cardinality(p.method_steps) > 0 OR p.results IS NOT NULL OR p.figures <> '[]'::jsonb
       OR p.limitations IS NOT NULL OR p.evaluation IS NOT NULL);

DROP TABLE summary_merge;

-- Bangla cards are left exactly as they are.

-- ===================== 4. Search document from the cards =====================

-- Replaced before the summary columns are dropped: a LANGUAGE sql body is not tracked as a
-- dependency, so the old one would only fail when called.
CREATE OR REPLACE FUNCTION refresh_paper_search(target bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE papers p SET search_vector =
       setweight(to_tsvector('english', p.title), 'A')
    || setweight(to_tsvector('english', coalesce(p.authors, '')), 'B')
    || setweight(to_tsvector('english', coalesce(
         (SELECT concat_ws(' ', c.question, array_to_string(c.extra_questions, ' '), c.key_idea)
          FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en'), '')), 'C')
    || setweight(to_tsvector('bangla', coalesce(
         (SELECT concat_ws(' ', c.question, array_to_string(c.extra_questions, ' '), c.key_idea)
          FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'bn'), '')), 'C')
  WHERE p.id = target;
$$;

-- ===================== 5. Drop what moved =====================

DROP INDEX papers_trend_idx, papers_sync_idx;
ALTER TABLE papers
  DROP COLUMN research_questions, DROP COLUMN main_idea, DROP COLUMN data_source, DROP COLUMN method_steps,
  DROP COLUMN results, DROP COLUMN figures, DROP COLUMN limitations, DROP COLUMN evaluation,
  DROP COLUMN doi, DROP COLUMN arxiv_id, DROP COLUMN openalex_id, DROP COLUMN s2_id,
  DROP COLUMN openalex_topics, DROP COLUMN tldr,
  DROP COLUMN citation_count, DROP COLUMN hf_upvotes, DROP COLUMN hf_trending_at, DROP COLUMN trend_rank,
  DROP COLUMN synced_at, DROP COLUMN sync_error;

SELECT refresh_paper_search(id) FROM papers;

-- Down Migration

-- Columns come back with their migration 005 names, constraints and defaults.
ALTER TABLE papers
  ADD COLUMN research_questions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN main_idea          text,
  ADD COLUMN data_source        text,
  ADD COLUMN method_steps       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN results            text,
  ADD COLUMN figures            jsonb  NOT NULL DEFAULT '[]',
  ADD COLUMN limitations        text,
  ADD COLUMN evaluation         text,
  ADD COLUMN doi                text UNIQUE,
  ADD COLUMN arxiv_id           text UNIQUE,
  ADD COLUMN openalex_id        text UNIQUE,
  ADD COLUMN s2_id              text UNIQUE,
  ADD COLUMN tldr               text,
  ADD COLUMN citation_count     integer CHECK (citation_count >= 0),
  ADD COLUMN hf_upvotes         integer CHECK (hf_upvotes >= 0),
  ADD COLUMN hf_trending_at     timestamptz,
  ADD COLUMN trend_rank         integer CHECK (trend_rank > 0),
  ADD COLUMN openalex_topics    jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN synced_at          timestamptz,
  ADD COLUMN sync_error         text;

UPDATE papers p SET doi = m.doi, arxiv_id = m.arxiv_id, openalex_id = m.openalex_id, s2_id = m.s2_id,
                    openalex_topics = m.openalex_topics, tldr = m.tldr
FROM paper_metadata m WHERE m.paper_id = p.id;
UPDATE papers p SET citation_count = m.citation_count, hf_upvotes = m.hf_upvotes,
                    hf_trending_at = m.hf_trending_at, trend_rank = m.trend_rank
FROM paper_metrics m WHERE m.paper_id = p.id;
UPDATE papers p SET synced_at = s.synced_at, sync_error = s.sync_error
FROM paper_sync s WHERE s.paper_id = p.id;

-- The summary columns take the English card's current content (the card stays, as in 005).
UPDATE papers p SET
  research_questions = CASE WHEN c.question IS NULL THEN c.extra_questions ELSE c.question || c.extra_questions END,
  main_idea = c.key_idea, data_source = c.data_source, method_steps = c.method_steps, results = c.findings,
  figures = c.figures, limitations = c.limitations, evaluation = c.evaluation
FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en';

CREATE OR REPLACE FUNCTION refresh_paper_search(target bigint) RETURNS void LANGUAGE sql AS $$
  UPDATE papers p SET search_vector =
       setweight(to_tsvector('english', p.title), 'A')
    || setweight(to_tsvector('english', coalesce(p.authors, '')), 'B')
    || setweight(to_tsvector('english', concat_ws(' ', p.main_idea,
         (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en'))), 'C')
    || setweight(to_tsvector('bangla', coalesce(
         (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'bn'), '')), 'C')
  WHERE p.id = target;
$$;

ALTER TABLE paper_cards DROP COLUMN figures, DROP COLUMN evaluation, DROP COLUMN data_source, DROP COLUMN extra_questions;
SELECT refresh_paper_search(id) FROM papers;

CREATE INDEX papers_trend_idx ON papers ((coalesce(trend_rank, 2147483647)), id) WHERE status = 'published';
CREATE INDEX papers_sync_idx ON papers (synced_at NULLS FIRST, id) WHERE doi IS NOT NULL OR arxiv_id IS NOT NULL;
DROP TABLE paper_sync, paper_metrics, paper_metadata;

-- Inactive blocks had been deleted before this migration.
DELETE FROM blocks WHERE NOT is_active;
ALTER TABLE blocks DROP COLUMN updated_at, DROP COLUMN is_active;
