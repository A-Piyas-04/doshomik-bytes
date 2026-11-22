-- Up Migration

-- Additions the Prototype 2 appendix does not have, needed to build what the doc specifies.
-- See docs/prototype-2-implementation-notes.md.

-- The API names a device session ("sign out of this device") and tokens carry it,
-- so it needs a public id like the other user-facing rows.
ALTER TABLE sessions ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

-- Two-factor sign-in, which the doc requires for admins and moderators.
-- totp_secret is encrypted by the API (AES-256-GCM) before it is stored.
ALTER TABLE users
  ADD COLUMN totp_secret     text,
  ADD COLUMN totp_enabled_at timestamptz;

-- Indexes for Prototype 2 queries
CREATE INDEX posts_reels_idx ON posts (created_at DESC, id DESC)
  WHERE type = 'reel' AND status = 'published' AND deleted_at IS NULL;
CREATE INDEX ON posts (media_id);
CREATE INDEX ON saved_posts (user_id, created_at DESC);
CREATE INDEX follows_pending_idx ON follows (following_id, created_at DESC) WHERE status = 'pending';

-- Down Migration

DROP INDEX follows_pending_idx;
DROP INDEX saved_posts_user_id_created_at_idx;
DROP INDEX posts_media_id_idx;
DROP INDEX posts_reels_idx;
ALTER TABLE users DROP COLUMN totp_enabled_at, DROP COLUMN totp_secret;
ALTER TABLE sessions DROP COLUMN public_id;
