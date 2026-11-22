import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { env } from '../config/env';
import { db, type Db } from '../db';
import type { OutboxEvents as OutboxEventsTable } from '../db/types';
import { hashToken, randomToken } from '../lib/crypto';
import { emitSearchSync, type OutboxEvents, type OutboxEventType } from '../lib/outbox';
import { storage } from '../lib/storage';
import { providers } from '../providers';
import { processedPrefix } from './media';
import { notify, type SideEffect } from './notify';

/** After this many failures an event stays unprocessed for someone to inspect. */
const MAX_ATTEMPTS = 10;

type Event = Selectable<OutboxEventsTable>;
type Handler = (trx: Db, event: Event) => Promise<(SideEffect | null)[]>;

const payloadOf = <T extends OutboxEventType>(event: Event) => event.payload as unknown as OutboxEvents[T];

/** Recounts instead of incrementing, so handling an event twice can't drift the numbers. */
async function refreshPostCounters(trx: Db, postId: number): Promise<void> {
  await sql`
    UPDATE posts SET
      like_count = (SELECT count(*) FROM post_likes WHERE post_id = ${postId}),
      comment_count = (SELECT count(*) FROM comments WHERE post_id = ${postId} AND deleted_at IS NULL)
    WHERE id = ${postId}`.execute(trx);
}

const handlers: Record<OutboxEventType, Handler> = {
  'follow.created': async (trx, event) => {
    const { follower_id } = payloadOf<'follow.created'>(event);
    const follow = await trx
      .selectFrom('follows')
      .select('status')
      .where('follower_id', '=', follower_id)
      .where('following_id', '=', event.entity_id)
      .executeTakeFirst();
    if (!follow) return []; // unfollowed before we got here
    const type = follow.status === 'pending' ? 'follow_request' : 'follow';
    return [await notify(trx, { userId: event.entity_id, actorId: follower_id, type })];
  },

  'post.liked': async (trx, event) => {
    const { user_id } = payloadOf<'post.liked'>(event);
    await refreshPostCounters(trx, event.entity_id);
    const like = await trx
      .selectFrom('post_likes as l')
      .innerJoin('posts as p', 'p.id', 'l.post_id')
      .select('p.user_id')
      .where('l.post_id', '=', event.entity_id)
      .where('l.user_id', '=', user_id)
      .executeTakeFirst();
    if (!like) return [];
    return [await notify(trx, { userId: like.user_id, actorId: user_id, type: 'like', postId: event.entity_id })];
  },

  'post.unliked': async (trx, event) => {
    await refreshPostCounters(trx, event.entity_id);
    return [];
  },

  /** A reply notifies the parent's author; any comment on a post also notifies the post's author. */
  'comment.created': async (trx, event) => {
    const comment = await trx
      .selectFrom('comments as c')
      .leftJoin('comments as parent', 'parent.id', 'c.parent_id')
      .leftJoin('posts as p', 'p.id', 'c.post_id')
      .select(['c.id', 'c.user_id', 'c.post_id', 'c.deleted_at', 'parent.user_id as parent_author', 'p.user_id as post_author'])
      .where('c.id', '=', event.entity_id)
      .executeTakeFirst();
    if (!comment || comment.user_id === null) return [];
    if (comment.post_id) await refreshPostCounters(trx, comment.post_id);
    if (comment.deleted_at) return [];

    const effects: (SideEffect | null)[] = [];
    const base = { actorId: comment.user_id, postId: comment.post_id, commentId: comment.id };
    if (comment.parent_author) effects.push(await notify(trx, { ...base, userId: comment.parent_author, type: 'reply' }));
    if (comment.post_author && comment.post_author !== comment.parent_author) {
      effects.push(await notify(trx, { ...base, userId: comment.post_author, type: 'comment' }));
    }
    return effects;
  },

  'comment.deleted': async (trx, event) => {
    const comment = await trx.selectFrom('comments').select('post_id').where('id', '=', event.entity_id).executeTakeFirst();
    if (comment?.post_id) await refreshPostCounters(trx, comment.post_id);
    return [];
  },

  /** Publishes posts waiting on this media, or makes it the owner's avatar. */
  'media.ready': async (trx, event) => {
    const asset = await trx
      .selectFrom('media_assets')
      .select(['id', 'owner_id', 'purpose', 'thumbnail_key'])
      .where('id', '=', event.entity_id)
      .where('status', '=', 'ready')
      .executeTakeFirst();
    if (!asset || asset.owner_id === null) return [];

    if (asset.purpose === 'post') {
      const posts = await trx
        .updateTable('posts')
        .set({ status: 'published', updated_at: new Date() })
        .where('media_id', '=', asset.id)
        .where('status', '=', 'processing')
        .where('deleted_at', 'is', null)
        .returning(['id', 'user_id'])
        .execute();
      const effects: (SideEffect | null)[] = [];
      for (const post of posts) {
        await emitSearchSync(trx, 'post', post.id);
        effects.push(await notify(trx, { userId: post.user_id, actorId: post.user_id, type: 'post_ready', postId: post.id }));
      }
      return effects;
    }

    if (asset.purpose === 'avatar' && asset.thumbnail_key) {
      await trx
        .updateTable('users')
        .set({ avatar_url: storage.publicUrl(asset.thumbnail_key), updated_at: new Date() })
        .where('id', '=', asset.owner_id)
        .execute();
      // Earlier avatars are no longer shown anywhere: remove them.
      const old = await trx
        .deleteFrom('media_assets')
        .where('owner_id', '=', asset.owner_id)
        .where('purpose', '=', 'avatar')
        .where('id', '!=', asset.id)
        .returning(['public_id', 'purpose'])
        .execute();
      return old.map((a) => () => storage.deleteProcessed(processedPrefix(a.purpose, a.public_id)));
    }
    return [];
  },

  'email.verify': async (trx, event) => {
    const user = await trx.selectFrom('users').select(['email', 'email_verified_at', 'status']).where('id', '=', event.entity_id).executeTakeFirst();
    if (!user || user.email_verified_at || user.status !== 'active') return [];
    const token = await createAuthToken(trx, event.entity_id, 'verify_email', 24 * 3600_000);
    return [
      () =>
        providers.email.send({
          to: user.email,
          subject: 'Verify your email for Doshomik Bytes',
          text: `Confirm your email by opening this link:\n${env.PUBLIC_URL}/verify-email?token=${token}\n\nThe link works for 24 hours.`,
        }),
    ];
  },

  'email.password_reset': async (trx, event) => {
    const user = await trx.selectFrom('users').select(['email', 'status']).where('id', '=', event.entity_id).executeTakeFirst();
    if (!user || user.status !== 'active') return [];
    const token = await createAuthToken(trx, event.entity_id, 'reset_password', 3600_000);
    return [
      () =>
        providers.email.send({
          to: user.email,
          subject: 'Reset your Doshomik Bytes password',
          text: `Choose a new password by opening this link:\n${env.PUBLIC_URL}/reset-password?token=${token}\n\nThe link works for 1 hour. If you didn't ask for this, ignore this email.`,
        }),
    ];
  },

  // Kept for the Elasticsearch indexer, which doesn't exist yet: nothing to do for now.
  'search.sync': async () => [],
};

/** A one-time code. Only its hash is stored; the plain code exists only in the email. */
async function createAuthToken(trx: Db, userId: number, purpose: 'verify_email' | 'reset_password', ttlMs: number) {
  const token = randomToken();
  await trx
    .insertInto('auth_tokens')
    .values({ user_id: userId, purpose, token_hash: hashToken(token), expires_at: new Date(Date.now() + ttlMs) })
    .execute();
  return token;
}

/**
 * Handles pending events in order. Each event's database work and its "processed" mark commit
 * together; push and email run after the commit. Returns how many events were picked up.
 */
export async function processOutboxBatch(log: Logger, limit = 50): Promise<number> {
  const events = await db
    .selectFrom('outbox_events')
    .selectAll()
    .where('processed_at', 'is', null)
    .where('attempts', '<', MAX_ATTEMPTS)
    .orderBy('id')
    .limit(limit)
    .execute();

  for (const event of events) {
    const handler = handlers[event.event_type as OutboxEventType];
    try {
      if (!handler) throw new Error(`No handler for outbox event "${event.event_type}"`);
      const effects = await db.transaction().execute(async (trx) => {
        const result = await handler(trx, event);
        await trx.updateTable('outbox_events').set({ processed_at: new Date(), attempts: sql`attempts + 1` }).where('id', '=', event.id).execute();
        return result;
      });
      for (const effect of effects) {
        if (effect) await effect().catch((error: unknown) => log.warn({ err: error, eventId: event.id }, 'Side effect failed'));
      }
    } catch (error) {
      log.error({ err: error, eventId: event.id, type: event.event_type }, 'Outbox event failed');
      await db.updateTable('outbox_events').set({ attempts: sql`attempts + 1` }).where('id', '=', event.id).execute();
    }
  }
  return events.length;
}
