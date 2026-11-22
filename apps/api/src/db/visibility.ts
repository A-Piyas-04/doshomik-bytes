import { sql, type RawBuilder } from 'kysely';

// Who may see what. Every query that returns user content or team content builds its WHERE
// clause from these, so the rules for blocks, private accounts, drafts and deleted items live in
// one place. `viewerId` is the caller's internal user id; arguments named like 'u' or 'p' are
// table aliases in the calling query.

type Condition = RawBuilder<boolean>;
const col = (table: string, column: string) => sql.ref(`${table}.${column}`);

/** The account is active: not suspended, not deleted. */
export function isActiveUser(u: string): Condition {
  return sql`${col(u, 'status')} = 'active'`;
}

/** Neither the viewer nor the user (by id column) has blocked the other. */
export function notBlocked(viewerId: number, userIdColumn: string): Condition {
  const userId = sql.ref(userIdColumn);
  return sql`NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${userId})
       OR (b.blocker_id = ${userId} AND b.blocked_id = ${viewerId})
  )`;
}

/** The viewer may open this user's profile: active and not blocked either way. */
export function canSeeProfile(viewerId: number, u: string): Condition {
  return sql`(${isActiveUser(u)} AND ${notBlocked(viewerId, `${u}.id`)})`;
}

/** The viewer is the user or an accepted follower. */
export function followsOrIs(viewerId: number, u: string): Condition {
  return sql`(${col(u, 'id')} = ${viewerId} OR EXISTS (
    SELECT 1 FROM follows f
    WHERE f.follower_id = ${viewerId} AND f.following_id = ${col(u, 'id')} AND f.status = 'accepted'
  ))`;
}

/** The viewer may see this user's posts and reading tracker: a visible profile that is public or followed. */
export function canSeeContentOf(viewerId: number, u: string): Condition {
  return sql`(${canSeeProfile(viewerId, u)} AND (NOT ${col(u, 'is_private')} OR ${followsOrIs(viewerId, u)}))`;
}

/** A post the viewer may see (author aliased `u`). Authors also see their own posts still processing. */
export function isVisiblePost(viewerId: number, p: string, u: string): Condition {
  return sql`(${col(p, 'deleted_at')} IS NULL
    AND (${col(p, 'status')} = 'published' OR (${col(p, 'status')} = 'processing' AND ${col(p, 'user_id')} = ${viewerId}))
    AND ${canSeeContentOf(viewerId, u)})`;
}

/** A post that may appear in search: published, live, from a public account the viewer may see. Private posts never do. */
export function isSearchablePost(viewerId: number, p: string, u: string): Condition {
  return sql`(${col(p, 'deleted_at')} IS NULL AND ${col(p, 'status')} = 'published'
    AND NOT ${col(u, 'is_private')} AND ${canSeeProfile(viewerId, u)})`;
}

/** Team content (papers, courses, learn items, questions, quizzes) that is live. Drafts and archived rows are staff-only. */
export function isPublished(table: string): Condition {
  return sql`${col(table, 'status')} = 'published'`;
}
