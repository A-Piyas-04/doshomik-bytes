-- Up Migration

-- Finishes the Prototype 2 changes the appendix leaves for after the backfill:
--   1. slugs for topics and fields, then NOT NULL
--   2. post media moves to media_assets; then posts.media_url and duration_seconds are dropped
--   3. a learn item may use an external media_url or a pipeline media_id

-- 1. Slugs: lowercase ASCII words joined by "-". The id is appended when two names collide
--    or a name has no ASCII letters (for example a Bangla-only name).
WITH base AS (
  SELECT id, trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS slug FROM topics
), ranked AS (
  SELECT id, slug, count(*) OVER (PARTITION BY slug) AS same FROM base
)
UPDATE topics t
SET slug = CASE WHEN r.slug = '' THEN 'topic-' || r.id WHEN r.same > 1 THEN r.slug || '-' || r.id ELSE r.slug END
FROM ranked r
WHERE r.id = t.id AND t.slug IS NULL;

WITH base AS (
  SELECT id, trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS slug FROM fields
), ranked AS (
  SELECT id, slug, count(*) OVER (PARTITION BY slug) AS same FROM base
)
UPDATE fields f
SET slug = CASE WHEN r.slug = '' THEN 'field-' || r.id WHEN r.same > 1 THEN r.slug || '-' || r.id ELSE r.slug END
FROM ranked r
WHERE r.id = f.id AND f.slug IS NULL;

ALTER TABLE topics ALTER COLUMN slug SET NOT NULL;
ALTER TABLE fields ALTER COLUMN slug SET NOT NULL;

-- 2. Prototype 1 image and reel files become ready media assets (provider 'legacy').
--    playback_key keeps the Prototype 1 URL, which the API returns unchanged.
WITH legacy AS (
  SELECT id AS post_id, gen_random_uuid() AS asset_public_id, user_id, type, media_url, duration_seconds, created_at
  FROM posts
  WHERE media_url IS NOT NULL AND media_id IS NULL
), inserted AS (
  INSERT INTO media_assets (public_id, owner_id, kind, purpose, status, provider, playback_key, duration_ms, created_at)
  SELECT asset_public_id, user_id, CASE WHEN type = 'reel' THEN 'video' ELSE 'image' END, 'post', 'ready', 'legacy',
         media_url, duration_seconds * 1000, created_at
  FROM legacy
  RETURNING id, public_id
)
UPDATE posts p
SET media_id = i.id
FROM legacy l
JOIN inserted i ON i.public_id = l.asset_public_id
WHERE p.id = l.post_id;

-- Dropping the columns also drops the Prototype 1 checks on them (posts_check1, posts_check2).
-- The 90-second reel limit now lives in the media worker, using media_assets.duration_ms.
ALTER TABLE posts DROP COLUMN media_url, DROP COLUMN duration_seconds;
ALTER TABLE posts ADD CONSTRAINT posts_media_check CHECK (type = 'text' OR media_id IS NOT NULL);

-- 3. Learn items
ALTER TABLE learn_items DROP CONSTRAINT learn_items_check,
  ADD CONSTRAINT learn_items_check CHECK (kind = 'text' OR media_url IS NOT NULL OR media_id IS NOT NULL);

-- Down Migration

ALTER TABLE learn_items DROP CONSTRAINT learn_items_check,
  ADD CONSTRAINT learn_items_check CHECK (kind = 'text' OR media_url IS NOT NULL);

ALTER TABLE posts DROP CONSTRAINT posts_media_check;
ALTER TABLE posts ADD COLUMN media_url text, ADD COLUMN duration_seconds smallint;
-- Lossy for Prototype 2 uploads: their playback_key is a storage key, not a Prototype 1 URL.
UPDATE posts p
SET media_url = m.playback_key,
    duration_seconds = greatest(1, m.duration_ms / 1000)
FROM media_assets m
WHERE m.id = p.media_id;
ALTER TABLE posts
  ADD CONSTRAINT posts_check1 CHECK (type = 'text' OR media_url IS NOT NULL),
  ADD CONSTRAINT posts_check2 CHECK (type <> 'reel' OR duration_seconds BETWEEN 1 AND 90);

ALTER TABLE topics ALTER COLUMN slug DROP NOT NULL;
ALTER TABLE fields ALTER COLUMN slug DROP NOT NULL;
