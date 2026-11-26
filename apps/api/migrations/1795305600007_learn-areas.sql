-- Up Migration

-- Learn areas (docs/frontend-implementation-notes.md §2).
--
-- The app organises Learn, Practice, Explore and Research by the same few areas (ML fundamentals,
-- Deep learning, Computer vision, Transformers, LLMs). Research already has them as `fields`. This
-- groups the fine-grained learn topics and the courses under a field as well, so one set of chips
-- filters every tab:
--
--   topics.field_id   the area a concept belongs to (learn items, questions, quizzes and tagged
--                     posts reach their area through their topic)
--   courses.field_id  the area of a course, ours or external (external courses have no items, so
--                     the area can't be derived from their topics)
--
-- Both are optional and SET NULL when a field is deleted: the topic or course stays, unfiled.
-- Additions only; no existing column or constraint changes.

ALTER TABLE topics  ADD COLUMN field_id bigint REFERENCES fields(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN field_id bigint REFERENCES fields(id) ON DELETE SET NULL;

CREATE INDEX topics_field_idx  ON topics (field_id)  WHERE field_id IS NOT NULL;
CREATE INDEX courses_field_idx ON courses (field_id) WHERE field_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS courses_field_idx;
DROP INDEX IF EXISTS topics_field_idx;
ALTER TABLE courses DROP COLUMN IF EXISTS field_id;
ALTER TABLE topics  DROP COLUMN IF EXISTS field_id;
