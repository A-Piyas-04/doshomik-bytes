import { sql } from 'kysely';
import { db } from '../../db';
import { badRequest, found } from '../../lib/errors';
import { storage } from '../../lib/storage';
import { notify } from '../notifications/notifications.service';

/** The signed-in user's own account. Never select password_hash outside auth. */
export const ACCOUNT_COLUMNS = ['id', 'username', 'email', 'display_name', 'bio', 'avatar_url', 'role', 'created_at'] as const;

export async function getAccount(userId: number) {
  return found(
    await db.selectFrom('users').select(ACCOUNT_COLUMNS).where('id', '=', userId).executeTakeFirst(),
    'User',
  );
}

export async function updateProfile(userId: number, changes: { display_name?: string | null; bio?: string | null }) {
  // Kysely skips undefined values, so only the fields sent are changed.
  if (Object.values(changes).every((value) => value === undefined)) return getAccount(userId);
  return db.updateTable('users').set(changes).where('id', '=', userId).returning(ACCOUNT_COLUMNS).executeTakeFirstOrThrow();
}

export async function setAvatar(userId: number, avatarUrl: string) {
  const previous = await db.selectFrom('users').select('avatar_url').where('id', '=', userId).executeTakeFirstOrThrow();
  const account = await db
    .updateTable('users')
    .set({ avatar_url: avatarUrl })
    .where('id', '=', userId)
    .returning(ACCOUNT_COLUMNS)
    .executeTakeFirstOrThrow();
  if (previous.avatar_url) await storage.remove(previous.avatar_url);
  return account;
}

/** A profile page: public fields, counts, and whether the viewer follows them. */
export async function getProfile(viewerId: number, userId: number) {
  const profile = await db
    .selectFrom('users as u')
    .where('u.id', '=', userId)
    .select((eb) => [
      'u.id',
      'u.username',
      'u.display_name',
      'u.bio',
      'u.avatar_url',
      'u.created_at',
      eb
        .selectFrom('posts')
        .whereRef('posts.user_id', '=', 'u.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('posts_count'),
      eb
        .selectFrom('follows')
        .whereRef('follows.following_id', '=', 'u.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('followers_count'),
      eb
        .selectFrom('follows')
        .whereRef('follows.follower_id', '=', 'u.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('following_count'),
      eb
        .exists(
          eb
            .selectFrom('follows')
            .whereRef('follows.following_id', '=', 'u.id')
            .where('follows.follower_id', '=', viewerId)
            .select(sql.lit(1).as('one')),
        )
        .as('is_following'),
    ])
    .executeTakeFirst();
  return found(profile, 'User');
}

/** People to follow on an empty Home: the most-followed users the viewer doesn't follow yet. */
export function suggestUsers(viewerId: number, limit: number) {
  return db
    .selectFrom('users as u')
    .where('u.id', '!=', viewerId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('follows')
            .whereRef('follows.following_id', '=', 'u.id')
            .where('follows.follower_id', '=', viewerId)
            .select(sql.lit(1).as('one')),
        ),
      ),
    )
    .select((eb) => [
      'u.id',
      'u.username',
      'u.display_name',
      'u.avatar_url',
      eb
        .selectFrom('follows')
        .whereRef('follows.following_id', '=', 'u.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('followers_count'),
    ])
    .orderBy('followers_count', 'desc')
    .orderBy('u.id', 'desc')
    .limit(limit)
    .execute();
}

export async function follow(followerId: number, followingId: number): Promise<void> {
  if (followerId === followingId) throw badRequest('You cannot follow yourself', 'SELF_FOLLOW');
  await assertUserExists(followingId);

  await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('follows')
      .values({ follower_id: followerId, following_id: followingId })
      .onConflict((oc) => oc.doNothing())
      .returning('follower_id')
      .executeTakeFirst();
    if (created) await notify(trx, { userId: followingId, actorId: followerId, type: 'follow' });
  });
}

export async function unfollow(followerId: number, followingId: number): Promise<void> {
  await db
    .deleteFrom('follows')
    .where('follower_id', '=', followerId)
    .where('following_id', '=', followingId)
    .execute();
}

export async function assertUserExists(userId: number): Promise<void> {
  found(await db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst(), 'User');
}
