-- Up Migration

-- Efficiency pass. See docs/prototype-2-implementation-notes.md §2.6.
--
--   1. post_likes: an unlike sets is_active = false instead of deleting the row, and a re-like sets it
--      back. Only the first like ever notifies the post's author, so like → unlike → like no longer
--      sends a new notification and push each time. is_active and updated_at are deliberately left
--      out of every index: flipping them is then a HOT update, with no index writes, where
--      DELETE + INSERT wrote two index entries (primary key and post_id) on every toggle.
--   2. follows: same idea with a third status, 'inactive' (unfollowed, withdrawn or declined), so
--      every existing "status = 'accepted'" privacy check stays correct without changes. Only the
--      first follow ever notifies. updated_at records when the current status began; follow requests
--      are listed by it.
--   3. users.follower_count and following_count: stored counts, as the Prototype 2 doc asks
--      ("stored ... follower counts, updated from outbox events"). Profiles stop running COUNT(*), and
--      "people to follow" stops counting the followers of every user before sorting.
--   4. notifications: a partial index for the unread badge, which runs on every app open.
--   5. posts: drops the Prototype 1 reels index. posts_reels_idx (migration 003) covers the same
--      order with the status and deleted_at filters the query uses, so the old one was only a
--      write cost on every reel insert.

-- 1. Likes
ALTER TABLE post_likes
  ADD COLUMN is_active  boolean     NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- post_likes_post_id_idx stays as it is: it serves the cascade when a post is purged and the
-- counter repair job, and adding is_active to it would make every toggle write the index.

-- 2. Follows
ALTER TABLE follows DROP CONSTRAINT follows_status_check,
  ADD CONSTRAINT follows_status_check CHECK (status IN ('accepted', 'pending', 'inactive'));
ALTER TABLE follows ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE follows SET updated_at = created_at;

-- Follow requests are listed newest first by when they were (re)sent.
DROP INDEX follows_pending_idx;
CREATE INDEX follows_pending_idx ON follows (following_id, updated_at DESC) WHERE status = 'pending';

-- 3. Stored follow counts, maintained by the worker from follow.changed events
ALTER TABLE users
  ADD COLUMN follower_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN following_count integer NOT NULL DEFAULT 0;

UPDATE users u SET
  follower_count  = (SELECT count(*) FROM follows f WHERE f.following_id = u.id AND f.status = 'accepted'),
  following_count = (SELECT count(*) FROM follows f WHERE f.follower_id  = u.id AND f.status = 'accepted');

-- "People to follow": the most-followed active users, read in index order instead of sorted.
CREATE INDEX users_suggest_idx ON users (follower_count DESC, id DESC) WHERE status = 'active';

-- 4. Unread notifications badge (the query uses "NOT n.is_read" to match)
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE NOT is_read;

-- 5. Redundant index (Prototype 1: CREATE INDEX ON posts (created_at DESC) WHERE type = 'reel')
DROP INDEX posts_created_at_idx;

-- Down Migration

CREATE INDEX posts_created_at_idx ON posts (created_at DESC) WHERE type = 'reel';

DROP INDEX notifications_unread_idx;

DROP INDEX users_suggest_idx;
ALTER TABLE users DROP COLUMN following_count, DROP COLUMN follower_count;

DROP INDEX follows_pending_idx;
CREATE INDEX follows_pending_idx ON follows (following_id, created_at DESC) WHERE status = 'pending';
-- Inactive follows had been deleted before this migration.
DELETE FROM follows WHERE status = 'inactive';
ALTER TABLE follows DROP COLUMN updated_at;
ALTER TABLE follows DROP CONSTRAINT follows_status_check,
  ADD CONSTRAINT follows_status_check CHECK (status IN ('accepted', 'pending'));

-- Inactive likes had been deleted before this migration.
DELETE FROM post_likes WHERE NOT is_active;
ALTER TABLE post_likes DROP COLUMN updated_at, DROP COLUMN is_active;
