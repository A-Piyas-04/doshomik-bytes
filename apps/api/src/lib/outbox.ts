import type { Db } from '../db';

/**
 * Events the worker acts on, with their payloads. Write them with `emit` inside the same
 * transaction as the change, so an event exists exactly when the change committed.
 */
export interface OutboxEvents {
  /** entity: the followed user. Only the first follow (or request) ever between the two: it notifies. */
  'follow.created': { follower_id: number };
  /** entity: the followed user. An accepted follow began (+1) or ended (-1): moves both stored counts. */
  'follow.changed': { follower_id: number; delta: 1 | -1 };
  /**
   * entity: post. Written only when a like actually becomes active. `first_like` is false for a
   * re-like, which counts but doesn't notify. Events from before migration 004 lack it: treat as true.
   */
  'post.liked': { user_id: number; first_like?: boolean };
  /** entity: post. Written only when an active like is undone. */
  'post.unliked': Record<string, never>;
  /** entity: comment */
  'comment.created': Record<string, never>;
  'comment.deleted': Record<string, never>;
  /** entity: media asset. The worker publishes waiting posts, sets avatars and notifies. */
  'media.ready': Record<string, never>;
  /** entity: user. The worker creates the one-time code (only its hash is stored) and emails it. */
  'email.verify': Record<string, never>;
  'email.password_reset': Record<string, never>;
  /**
   * A searchable record changed (entity_type says which). No consumer yet: the Elasticsearch
   * indexer will read these. See docs/prototype-2-implementation-notes.md.
   */
  'search.sync': Record<string, never>;
}

export type OutboxEventType = keyof OutboxEvents;

const ENTITY_TYPES: Record<Exclude<OutboxEventType, 'search.sync'>, string> = {
  'follow.created': 'user',
  'follow.changed': 'user',
  'post.liked': 'post',
  'post.unliked': 'post',
  'comment.created': 'comment',
  'comment.deleted': 'comment',
  'media.ready': 'media',
  'email.verify': 'user',
  'email.password_reset': 'user',
};

export async function emit<T extends Exclude<OutboxEventType, 'search.sync'>>(
  trx: Db,
  type: T,
  entityId: number,
  payload: OutboxEvents[T],
): Promise<void> {
  await trx
    .insertInto('outbox_events')
    .values({ event_type: type, entity_type: ENTITY_TYPES[type], entity_id: entityId, payload: JSON.stringify(payload) })
    .execute();
}

export type SearchEntity = 'user' | 'post' | 'topic' | 'learn_item' | 'course' | 'paper';

/** Records that a searchable record changed, for the search indexer. */
export async function emitSearchSync(trx: Db, entityType: SearchEntity, entityId: number): Promise<void> {
  await trx
    .insertInto('outbox_events')
    .values({ event_type: 'search.sync', entity_type: entityType, entity_id: entityId, payload: '{}' })
    .execute();
}
