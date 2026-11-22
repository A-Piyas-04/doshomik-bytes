import { sql } from 'kysely';
import type { Logger } from 'pino';
import { env } from '../config/env';
import { db } from '../db';
import { storage } from '../lib/storage';
import { processedPrefix } from './media';

// Periodic jobs. The worker runs them about once an hour; each is safe to run any number of times.

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

type OwnedMedia = { id: number; public_id: string; purpose: string; raw_key: string | null };

async function deleteMediaFiles(assets: OwnedMedia[]): Promise<void> {
  for (const asset of assets) {
    await storage.deleteProcessed(processedPrefix(asset.purpose, asset.public_id));
    if (asset.raw_key) await storage.deleteRaw(asset.raw_key);
  }
}

/**
 * Accounts deleted more than ACCOUNT_PURGE_DAYS ago lose their data. Their comments stay as
 * "[deleted]" placeholders with the text erased, so other people's reply threads survive.
 */
export async function purgeDeletedAccounts(log: Logger): Promise<number> {
  const users = await db
    .selectFrom('users')
    .select('id')
    .where('status', '=', 'deleted')
    .where('deleted_at', '<', days(env.ACCOUNT_PURGE_DAYS))
    .execute();

  for (const { id } of users) {
    const media = await db
      .selectFrom('media_assets')
      .select(['id', 'public_id', 'purpose', 'raw_key'])
      .where('owner_id', '=', id)
      .where('purpose', 'in', ['post', 'avatar'])
      .execute();

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('comments').set({ body: '', deleted_at: sql`coalesce(deleted_at, now())` }).where('user_id', '=', id).execute();
      await trx.deleteFrom('users').where('id', '=', id).execute(); // cascades posts, likes, follows, sessions...
      if (media.length) await trx.deleteFrom('media_assets').where('id', 'in', media.map((m) => m.id)).execute();
      await trx.insertInto('audit_log').values({ actor_id: null, action: 'user.purge', entity_type: 'user', entity_id: id }).execute();
    });
    await deleteMediaFiles(media);
  }
  if (users.length) log.info({ count: users.length }, 'Purged deleted accounts');
  return users.length;
}

/** Posts their authors deleted are removed for good, with their media, after the same grace period. */
export async function purgeDeletedPosts(log: Logger): Promise<number> {
  const posts = await db
    .selectFrom('posts as p')
    .leftJoin('media_assets as m', 'm.id', 'p.media_id')
    .select(['p.id', 'm.id as media_id', 'm.public_id', 'm.purpose', 'm.raw_key'])
    .where('p.deleted_at', '<', days(env.ACCOUNT_PURGE_DAYS))
    .execute();
  if (!posts.length) return 0;

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('posts').where('id', 'in', posts.map((p) => p.id)).execute();
    const mediaIds = posts.flatMap((p) => (p.media_id ? [p.media_id] : []));
    if (mediaIds.length) await trx.deleteFrom('media_assets').where('id', 'in', mediaIds).execute();
  });
  await deleteMediaFiles(posts.flatMap((p) => (p.media_id ? [{ id: p.media_id, public_id: p.public_id!, purpose: p.purpose!, raw_key: p.raw_key }] : [])));
  log.info({ count: posts.length }, 'Purged deleted posts');
  return posts.length;
}

/**
 * Repairs stored counts that drifted from the real rows. The worker moves counts by ±1 per event;
 * drift comes from paths that emit no event, mainly account purges (cascaded likes and follows,
 * blanked comments).
 */
export async function repairCounters(log: Logger): Promise<number> {
  const posts = await sql`
    UPDATE posts p SET like_count = c.likes, comment_count = c.comments
    FROM (
      SELECT p2.id,
        (SELECT count(*) FROM post_likes l WHERE l.post_id = p2.id AND l.is_active) AS likes,
        (SELECT count(*) FROM comments c WHERE c.post_id = p2.id AND c.deleted_at IS NULL) AS comments
      FROM posts p2
    ) c
    WHERE c.id = p.id AND (p.like_count <> c.likes OR p.comment_count <> c.comments)`.execute(db);
  const users = await sql`
    UPDATE users u SET follower_count = c.followers, following_count = c.following
    FROM (
      SELECT u2.id,
        (SELECT count(*) FROM follows f WHERE f.following_id = u2.id AND f.status = 'accepted') AS followers,
        (SELECT count(*) FROM follows f WHERE f.follower_id = u2.id AND f.status = 'accepted') AS following
      FROM users u2
    ) c
    WHERE c.id = u.id AND (u.follower_count <> c.followers OR u.following_count <> c.following)`.execute(db);
  const fixed = Number(posts.numAffectedRows ?? 0) + Number(users.numAffectedRows ?? 0);
  if (fixed) log.warn({ count: fixed }, 'Repaired drifted counters');
  return fixed;
}

/** Abandoned uploads, ended sessions, used codes and old processed events. */
export async function cleanUp(log: Logger): Promise<void> {
  const abandoned = await db
    .deleteFrom('media_assets as m')
    .where('m.status', 'in', ['uploading', 'failed'])
    .where('m.updated_at', '<', days(1))
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('posts').select('id').whereRef('posts.media_id', '=', 'm.id'))))
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('learn_items').select('id').whereRef('learn_items.media_id', '=', 'm.id'))))
    .returning(['id', 'public_id', 'purpose', 'raw_key'])
    .execute();
  await deleteMediaFiles(abandoned);

  await db
    .deleteFrom('sessions')
    .where((eb) => eb.or([eb('expires_at', '<', days(30)), eb('revoked_at', '<', days(30))]))
    .execute();
  await db
    .deleteFrom('auth_tokens')
    .where((eb) => eb.or([eb('expires_at', '<', days(7)), eb('used_at', '<', days(7))]))
    .execute();
  await db.deleteFrom('outbox_events').where('processed_at', '<', days(30)).execute();
  if (abandoned.length) log.info({ count: abandoned.length }, 'Removed abandoned uploads');
}

export async function runMaintenance(log: Logger): Promise<void> {
  for (const job of [purgeDeletedAccounts, purgeDeletedPosts, repairCounters, cleanUp]) {
    try {
      await job(log);
    } catch (error) {
      log.error({ err: error, job: job.name }, 'Maintenance job failed');
    }
  }
}
