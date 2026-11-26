import type { FollowStatus } from '@doshomik/shared';
import argon2 from 'argon2';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { db, type Db } from '../../db';
import { canSeeProfile, isActiveUser, notBlocked } from '../../db/visibility';
import { audit } from '../../lib/audit';
import { badRequest, found, notFound, unauthorized } from '../../lib/errors';
import { emit, emitSearchSync } from '../../lib/outbox';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { userSummary } from './user-summary';

/** The signed-in user's own account. password_hash and totp_secret are never selected outside auth. */
export async function getAccount(userId: number) {
  const account = await db
    .selectFrom('users')
    .select([
      'public_id as id',
      'username',
      'email',
      'display_name',
      'bio',
      'avatar_url',
      'role',
      'is_private',
      'created_at',
      sql<boolean>`email_verified_at IS NOT NULL`.as('email_verified'),
      sql<boolean>`totp_enabled_at IS NOT NULL`.as('two_factor_enabled'),
    ])
    .where('id', '=', userId)
    .executeTakeFirst();
  return found(account, 'User');
}

export async function updateProfile(
  userId: number,
  changes: { display_name?: string | null; bio?: string | null; is_private?: boolean },
) {
  // Kysely skips undefined values, so only the fields sent are changed.
  if (Object.values(changes).every((value) => value === undefined)) return getAccount(userId);

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
    // Going public lets everyone in: waiting follow requests are accepted.
    if (changes.is_private === false) {
      const accepted = await trx
        .updateTable('follows')
        .set({ status: 'accepted', updated_at: sql`now()` })
        .where('following_id', '=', userId)
        .where('status', '=', 'pending')
        .returning('follower_id')
        .execute();
      for (const { follower_id } of accepted) await emit(trx, 'follow.changed', userId, { follower_id, delta: 1 });
    }
    await emitSearchSync(trx, 'user', userId);
  });
  return getAccount(userId);
}

/**
 * Starts account deletion: the account disappears at once and every session ends. The worker
 * purges its data after ACCOUNT_PURGE_DAYS. Password accounts must confirm with the password.
 */
export async function deleteAccount(request: FastifyRequest, password: string | undefined): Promise<void> {
  const { userId } = request.auth;
  const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
  if (user.password_hash && !(password && (await argon2.verify(user.password_hash, password)))) {
    throw unauthorized('Wrong password');
  }

  await db.transaction().execute(async (trx) => {
    const now = new Date();
    await trx.updateTable('users').set({ status: 'deleted', deleted_at: now, updated_at: now }).where('id', '=', userId).execute();
    await trx.updateTable('sessions').set({ revoked_at: now }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
    await emitSearchSync(trx, 'user', userId);
    await audit(trx, request, { action: 'user.delete_request', entityType: 'user', entityId: userId });
  });
}

/** Suspends an account and signs it out everywhere. Used by moderation and admins. */
export async function suspendUser(trx: Db, userId: number): Promise<void> {
  const now = new Date();
  await trx.updateTable('users').set({ status: 'suspended', updated_at: now }).where('id', '=', userId).execute();
  await trx.updateTable('sessions').set({ revoked_at: now }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
  await emitSearchSync(trx, 'user', userId);
}

/** A profile page. 404 when the account is inactive or either side has blocked the other. */
export async function getProfile(viewerId: number, userPublicId: string) {
  const profile = await db
    .selectFrom('users as u')
    .where('u.public_id', '=', userPublicId)
    .where(canSeeProfile(viewerId, 'u'))
    .select((eb) => [
      'u.public_id as id',
      'u.username',
      'u.display_name',
      'u.bio',
      'u.avatar_url',
      'u.is_private',
      'u.created_at',
      sql<boolean>`u.id = ${viewerId}`.as('is_me'),
      eb
        .selectFrom('posts')
        .whereRef('posts.user_id', '=', 'u.id')
        .where('posts.status', '=', 'published')
        .where('posts.deleted_at', 'is', null)
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('posts_count'),
      // Stored counts, kept by the worker from follow.changed events (seconds behind at most).
      'u.follower_count as followers_count',
      'u.following_count',
      eb
        .selectFrom('follows')
        .whereRef('follows.following_id', '=', 'u.id')
        .where('follows.follower_id', '=', viewerId)
        .where('follows.status', '!=', 'inactive')
        .select('follows.status')
        .as('follow_status'),
    ])
    .executeTakeFirst();
  const row = found(profile, 'User');
  return { ...row, follow_status: (row.follow_status ?? 'none') as FollowStatus | 'none' };
}

/**
 * People to follow on an empty Home: the most-followed active users the viewer has no follow or
 * request with. Reads users_suggest_idx in order, so no user's followers are counted here.
 */
export function suggestUsers(viewerId: number, limit: number) {
  return db
    .selectFrom('users as u')
    .where('u.id', '!=', viewerId)
    .where(isActiveUser('u'))
    .where(notBlocked(viewerId, 'u.id'))
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('follows')
            .whereRef('follows.following_id', '=', 'u.id')
            .where('follows.follower_id', '=', viewerId)
            .where('follows.status', '!=', 'inactive')
            .select(sql.lit(1).as('one')),
        ),
      ),
    )
    .select(['u.public_id as id', 'u.username', 'u.display_name', 'u.avatar_url', 'u.is_private', 'u.follower_count as followers_count'])
    .orderBy('u.follower_count', 'desc')
    .orderBy('u.id', 'desc')
    .limit(limit)
    .execute();
}

/** The internal id of a user the viewer may see, or 404. */
export async function visibleUserId(viewerId: number, userPublicId: string): Promise<number> {
  const user = await db
    .selectFrom('users as u')
    .select('u.id')
    .where('u.public_id', '=', userPublicId)
    .where(canSeeProfile(viewerId, 'u'))
    .executeTakeFirst();
  return found(user, 'User').id;
}

const idOfUser = (publicId: string) => db.selectFrom('users').select('id').where('public_id', '=', publicId);

/** Follows a public account, or sends a follow request to a private one. */
export async function follow(followerId: number, userPublicId: string): Promise<{ status: FollowStatus }> {
  const target = found(
    await db
      .selectFrom('users as u')
      .select(['u.id', 'u.is_private'])
      .where('u.public_id', '=', userPublicId)
      .where(canSeeProfile(followerId, 'u'))
      .executeTakeFirst(),
    'User',
  );
  if (target.id === followerId) throw badRequest('You cannot follow yourself', 'SELF_FOLLOW');

  // A follow is one row per pair. Unfollowing sets it 'inactive' and following again reactivates
  // it, so only the first follow ever notifies: follow → unfollow → follow can't spam alerts.
  return db.transaction().execute(async (trx) => {
    const status: FollowStatus = target.is_private ? 'pending' : 'accepted';
    const changed = await trx
      .insertInto('follows')
      .values({ follower_id: followerId, following_id: target.id, status })
      .onConflict((oc) =>
        oc
          .columns(['follower_id', 'following_id'])
          .doUpdateSet({ status, updated_at: sql`now()` })
          .where('follows.status', '=', 'inactive'),
      )
      // xmax is 0 only for a freshly inserted row: a first follow, not a reactivated one.
      .returning(sql<boolean>`(xmax = 0)`.as('first_follow'))
      .executeTakeFirst();
    if (changed) {
      if (changed.first_follow) await emit(trx, 'follow.created', target.id, { follower_id: followerId });
      if (status === 'accepted') await emit(trx, 'follow.changed', target.id, { follower_id: followerId, delta: 1 });
      return { status };
    }
    // Already following, or already requested.
    const existing = await trx
      .selectFrom('follows')
      .select('status')
      .where('follower_id', '=', followerId)
      .where('following_id', '=', target.id)
      .executeTakeFirstOrThrow();
    return { status: existing.status as FollowStatus };
  });
}

/**
 * Ends a follow or a pending request, keeping the row as 'inactive'. Ending an accepted follow
 * moves the stored counts. Does nothing if there is no live follow.
 */
async function endFollow(trx: Db, followerId: number, followingId: number): Promise<void> {
  const current = await trx
    .selectFrom('follows')
    .select('status')
    .where('follower_id', '=', followerId)
    .where('following_id', '=', followingId)
    .where('status', '!=', 'inactive')
    .forUpdate()
    .executeTakeFirst();
  if (!current) return;
  await trx
    .updateTable('follows')
    .set({ status: 'inactive', updated_at: sql`now()` })
    .where('follower_id', '=', followerId)
    .where('following_id', '=', followingId)
    .execute();
  if (current.status === 'accepted') await emit(trx, 'follow.changed', followingId, { follower_id: followerId, delta: -1 });
}

/** Unfollows, or withdraws a pending request. */
export async function unfollow(followerId: number, userPublicId: string): Promise<void> {
  const target = await idOfUser(userPublicId).executeTakeFirst();
  if (!target) return;
  await db.transaction().execute((trx) => endFollow(trx, followerId, target.id));
}

/** Waiting requests, newest first by when they were (re)sent. */
export function listFollowRequests(userId: number, page: PageQuery) {
  const query = db
    .selectFrom('follows as f')
    .innerJoin('users as u', 'u.id', 'f.follower_id')
    .where('f.following_id', '=', userId)
    .where('f.status', '=', 'pending')
    .where(isActiveUser('u'))
    .select(['u.public_id as id', 'u.username', 'u.display_name', 'u.avatar_url', 'f.updated_at as requested_at']);
  return fetchPage(query, { createdAt: 'f.updated_at', id: 'f.follower_id' }, page);
}

export async function acceptFollowRequest(userId: number, requesterPublicId: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const accepted = await trx
      .updateTable('follows')
      .set({ status: 'accepted', updated_at: sql`now()` })
      .where('following_id', '=', userId)
      .where('follower_id', '=', idOfUser(requesterPublicId))
      .where('status', '=', 'pending')
      .returning('follower_id')
      .executeTakeFirst();
    if (!accepted) throw notFound('Follow request');
    await emit(trx, 'follow.changed', userId, { follower_id: accepted.follower_id, delta: 1 });
  });
}

/** The row stays as 'inactive', so a repeated request from the same person doesn't notify again. */
export async function declineFollowRequest(userId: number, requesterPublicId: string): Promise<void> {
  const result = await db
    .updateTable('follows')
    .set({ status: 'inactive', updated_at: sql`now()` })
    .where('following_id', '=', userId)
    .where('follower_id', '=', idOfUser(requesterPublicId))
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw notFound('Follow request');
}

/** Blocks a user: hides each from the other everywhere, and ends follows in both directions. */
export async function block(blockerId: number, userPublicId: string): Promise<void> {
  const target = found(
    await db.selectFrom('users').select('id').where('public_id', '=', userPublicId).where('status', '=', 'active').executeTakeFirst(),
    'User',
  );
  if (target.id === blockerId) throw badRequest('You cannot block yourself', 'SELF_BLOCK');

  await db.transaction().execute(async (trx) => {
    // One row per pair: blocking again reactivates it, keeping created_at (the first block).
    await trx
      .insertInto('blocks')
      .values({ blocker_id: blockerId, blocked_id: target.id })
      .onConflict((oc) =>
        oc.columns(['blocker_id', 'blocked_id']).doUpdateSet({ is_active: true, updated_at: sql`now()` }).where('blocks.is_active', '=', false),
      )
      .execute();
    // Kept as 'inactive' rather than deleted, so block → unblock → follow can't re-notify either.
    await endFollow(trx, blockerId, target.id);
    await endFollow(trx, target.id, blockerId);
  });
}

/** Ends a block, keeping the row with is_active = false. Does nothing if there is no active block. */
export async function unblock(blockerId: number, userPublicId: string): Promise<void> {
  await db
    .updateTable('blocks')
    .set({ is_active: false, updated_at: sql`now()` })
    .where('blocker_id', '=', blockerId)
    .where('blocked_id', '=', idOfUser(userPublicId))
    .where('is_active', '=', true)
    .execute();
}

/** The user's active blocks, most recent first by when each (re)started. */
export function listBlocks(userId: number, page: PageQuery) {
  const query = db
    .selectFrom('blocks as b')
    .innerJoin('users as u', 'u.id', 'b.blocked_id')
    .where('b.blocker_id', '=', userId)
    .where('b.is_active', '=', true)
    .select([userSummary('u').as('user'), 'b.updated_at as blocked_at']);
  return fetchPage(query, { createdAt: 'b.updated_at', id: 'b.blocked_id' }, page);
}

/** Fields picked at onboarding. */
export function getInterests(userId: number) {
  return db
    .selectFrom('user_fields as uf')
    .innerJoin('fields as f', 'f.id', 'uf.field_id')
    .select(['f.slug', 'f.name'])
    .where('uf.user_id', '=', userId)
    .orderBy('f.name')
    .execute();
}

export async function setInterests(userId: number, fieldSlugs: string[]) {
  await db.transaction().execute(async (trx) => {
    const fields = fieldSlugs.length
      ? await trx.selectFrom('fields').select(['id', 'slug']).where('slug', 'in', fieldSlugs).execute()
      : [];
    const unknown = fieldSlugs.filter((s) => !fields.some((f) => f.slug === s));
    if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}`, 'UNKNOWN_FIELD');

    // Only the difference is written: fields dropped from the list are removed, new ones added,
    // and the ones that stay are left alone (previously every save deleted and re-inserted all).
    const keep = fields.map((f) => f.id);
    await trx
      .deleteFrom('user_fields')
      .where('user_id', '=', userId)
      .$if(keep.length > 0, (qb) => qb.where('field_id', 'not in', keep))
      .execute();
    if (keep.length) {
      await trx
        .insertInto('user_fields')
        .values(keep.map((field_id) => ({ user_id: userId, field_id })))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  });
  return getInterests(userId);
}
