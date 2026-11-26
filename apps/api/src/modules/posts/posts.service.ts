import type { PostType } from '@doshomik/shared';
import { sql } from 'kysely';
import { env } from '../../config/env';
import { db } from '../../db';
import { isSearchablePost, isVisiblePost } from '../../db/visibility';
import { badRequest, conflict, forbidden, found, notFound } from '../../lib/errors';
import { emit, emitSearchSync } from '../../lib/outbox';
import { fetchPage, mapPage, type PageQuery } from '../../lib/pagination';
import { inArea, topicRef } from '../learn/learn.service';
import { MEDIA_COLUMNS, mediaView, type MediaColumns } from '../media/media.service';
import { userSummary, type UserSummary } from '../users/user-summary';
import { visibleUserId } from '../users/users.service';

/** Posts the viewer may see, with author, media, stored counters and the viewer's like and save. */
export function selectPosts(viewerId: number) {
  return db
    .selectFrom('posts as p')
    .innerJoin('users as u', 'u.id', 'p.user_id')
    .leftJoin('media_assets as m', 'm.id', 'p.media_id')
    .leftJoin('topics as pt', 'pt.id', 'p.topic_id')
    .where(isVisiblePost(viewerId, 'p', 'u'))
    .select((eb) => [
      'p.public_id as id',
      'p.type',
      'p.caption',
      topicRef('pt').as('topic'),
      'p.status',
      'p.like_count',
      'p.comment_count',
      'p.created_at',
      'u.is_private as author_is_private',
      userSummary('u').as('author'),
      ...MEDIA_COLUMNS,
      eb
        .exists(
          eb
            .selectFrom('post_likes as l')
            .whereRef('l.post_id', '=', 'p.id')
            .where('l.user_id', '=', viewerId)
            .where('l.is_active', '=', true)
            .select(sql.lit(1).as('one')),
        )
        .$castTo<boolean>()
        .as('liked_by_me'),
      eb
        .exists(eb.selectFrom('saved_posts as s').whereRef('s.post_id', '=', 'p.id').where('s.user_id', '=', viewerId).select(sql.lit(1).as('one')))
        .$castTo<boolean>()
        .as('saved_by_me'),
    ]);
}

type PostRow = MediaColumns & {
  id: string;
  type: string;
  caption: string | null;
  topic: { slug: string; name: string; field: string | null } | null;
  status: string;
  like_count: number;
  comment_count: number;
  created_at: Date;
  author_is_private: boolean;
  author: UserSummary;
  liked_by_me: boolean;
  saved_by_me: boolean;
};

/** The API shape of a post. Media URLs are signed for 1–2 hours when the author's account is private. */
export function toPost(row: PostRow) {
  return {
    id: row.id,
    type: row.type,
    caption: row.caption,
    topic: row.topic,
    status: row.status,
    media: mediaView(row, { private: row.author_is_private }),
    like_count: row.like_count,
    comment_count: row.comment_count,
    liked_by_me: row.liked_by_me,
    saved_by_me: row.saved_by_me,
    created_at: row.created_at,
    author: row.author,
    share_url: `${env.PUBLIC_URL}/p/${row.id}`,
  };
}

export async function getPost(viewerId: number, postPublicId: string) {
  return toPost(found(await selectPosts(viewerId).where('p.public_id', '=', postPublicId).executeTakeFirst(), 'Post'));
}

/** Home: published posts by people the viewer follows (accepted), newest first. */
export async function listFeed(viewerId: number, page: PageQuery) {
  const query = selectPosts(viewerId)
    .innerJoin('follows as f', 'f.following_id', 'p.user_id')
    .where('f.follower_id', '=', viewerId)
    .where('f.status', '=', 'accepted')
    .where('p.status', '=', 'published');
  return mapPage(await fetchPage(query, 'p', page), toPost);
}

/** Newest reels the viewer may see. Ranking by engagement waits for Redis and watch data. */
export async function listReels(viewerId: number, page: PageQuery) {
  const query = selectPosts(viewerId).where('p.type', '=', 'reel').where('p.status', '=', 'published');
  return mapPage(await fetchPage(query, 'p', page), toPost);
}

/**
 * Explore: published posts from public accounts the viewer may see, newest first, without the
 * viewer's own. The same rule as search (isSearchablePost), so private posts never appear. `field`
 * keeps one learn area's posts, through the topic each post is tagged with (migration 007).
 * Ranking by engagement waits for Redis and watch data, like the Reels order.
 */
export async function listExplore(viewerId: number, filter: { field?: string }, page: PageQuery) {
  const query = selectPosts(viewerId)
    .where(isSearchablePost(viewerId, 'p', 'u'))
    .where('p.user_id', '!=', viewerId)
    .$if(filter.field !== undefined, (qb) => qb.where(inArea('pt', filter.field!)));
  return mapPage(await fetchPage(query, 'p', page), toPost);
}

export async function listUserPosts(viewerId: number, userPublicId: string, page: PageQuery) {
  const userId = await visibleUserId(viewerId, userPublicId);
  return mapPage(await fetchPage(selectPosts(viewerId).where('p.user_id', '=', userId), 'p', page), toPost);
}

export async function listSavedPosts(userId: number, page: PageQuery) {
  const query = selectPosts(userId).innerJoin('saved_posts as saved', 'saved.post_id', 'p.id').where('saved.user_id', '=', userId);
  return mapPage(await fetchPage(query, { createdAt: 'saved.created_at', id: 'saved.post_id' }, page), toPost);
}

/**
 * Text posts need a caption. Image and reel posts need the id of an upload the author completed
 * (POST /v1/media/:id/complete). If that upload is still processing, the post waits as
 * "processing" and the worker publishes it, with a "your post is live" notification.
 */
export async function createPost(userId: number, input: { type: PostType; caption: string | null; media_id?: string; topic?: string }) {
  const { type, caption } = input;
  if (type === 'text' && !caption) throw badRequest('Text posts need a caption');
  if (type === 'text' && input.media_id) throw badRequest('Text posts cannot have media');
  if (type !== 'text' && !input.media_id) throw badRequest(`${type === 'image' ? 'Image' : 'Reel'} posts need a media_id`);

  const postPublicId = await db.transaction().execute(async (trx) => {
    let media: { id: number; status: string } | null = null;
    if (input.media_id) {
      // Lock the asset so the worker can't mark it ready between this check and the insert.
      const asset = await trx
        .selectFrom('media_assets')
        .select(['id', 'owner_id', 'kind', 'purpose', 'status'])
        .where('public_id', '=', input.media_id)
        .forUpdate()
        .executeTakeFirst();
      if (!asset || asset.owner_id !== userId) throw notFound('Media');
      const expectedKind = type === 'image' ? 'image' : 'video';
      if (asset.purpose !== 'post' || asset.kind !== expectedKind) throw badRequest(`This post needs a ${expectedKind} uploaded for a post`);
      if (asset.status !== 'processing' && asset.status !== 'ready') {
        throw conflict(asset.status === 'failed' ? 'This upload failed. Upload the file again.' : 'Finish the upload first', 'MEDIA_NOT_READY');
      }
      const inUse = await trx.selectFrom('posts').select('id').where('media_id', '=', asset.id).executeTakeFirst();
      if (inUse) throw conflict('This upload is already used by another post', 'MEDIA_IN_USE');
      media = asset;
    }

    // An optional concept tag, so a reel can be the link for a paper's Learn first topic.
    let topicId: number | null = null;
    if (input.topic) {
      const topic = await trx.selectFrom('topics').select('id').where('slug', '=', input.topic).executeTakeFirst();
      if (!topic) throw badRequest(`Unknown topic: ${input.topic}`, 'UNKNOWN_REFERENCE');
      topicId = topic.id;
    }

    const post = await trx
      .insertInto('posts')
      .values({
        user_id: userId,
        type,
        caption,
        topic_id: topicId,
        media_id: media?.id ?? null,
        status: media && media.status !== 'ready' ? 'processing' : 'published',
      })
      .returning(['id', 'public_id'])
      .executeTakeFirstOrThrow();
    await emitSearchSync(trx, 'post', post.id);
    return post.public_id;
  });

  return getPost(userId, postPublicId);
}

/** Soft delete: the post disappears now; the worker removes it and its media after the grace period. */
export async function deletePost(userId: number, postPublicId: string): Promise<void> {
  const post = found(
    await db.selectFrom('posts').select(['id', 'user_id']).where('public_id', '=', postPublicId).where('deleted_at', 'is', null).executeTakeFirst(),
    'Post',
  );
  if (post.user_id !== userId) throw forbidden('You can only delete your own posts');

  await db.transaction().execute(async (trx) => {
    const now = new Date();
    await trx.updateTable('posts').set({ deleted_at: now, updated_at: now }).where('id', '=', post.id).execute();
    await emitSearchSync(trx, 'post', post.id);
  });
}

/** The internal id and author of a post the viewer may see, or 404. */
export async function visiblePost(viewerId: number, postPublicId: string) {
  const post = await db
    .selectFrom('posts as p')
    .innerJoin('users as u', 'u.id', 'p.user_id')
    .select(['p.id', 'p.user_id'])
    .where('p.public_id', '=', postPublicId)
    .where(isVisiblePost(viewerId, 'p', 'u'))
    .executeTakeFirst();
  return found(post, 'Post');
}

/**
 * A like is one row per user and post, toggled with `is_active`: unliking keeps the row, and
 * liking again flips it back. An event is written only when the state really changes, and only
 * the first like ever notifies the author. Counting and notifying happen in the worker.
 */
export async function likePost(userId: number, postPublicId: string): Promise<void> {
  const post = await visiblePost(userId, postPublicId);
  await db.transaction().execute(async (trx) => {
    const changed = await trx
      .insertInto('post_likes')
      .values({ user_id: userId, post_id: post.id })
      .onConflict((oc) =>
        oc
          .columns(['user_id', 'post_id'])
          .doUpdateSet({ is_active: true, updated_at: sql`now()` })
          .where('post_likes.is_active', '=', false),
      )
      // xmax is 0 only for a freshly inserted row, so this tells a first like from a re-like.
      .returning(sql<boolean>`(xmax = 0)`.as('first_like'))
      .executeTakeFirst();
    // No row back: the like was already active, so nothing changed.
    if (changed) await emit(trx, 'post.liked', post.id, { user_id: userId, first_like: changed.first_like });
  });
}

export async function unlikePost(userId: number, postPublicId: string): Promise<void> {
  const post = await visiblePost(userId, postPublicId);
  await db.transaction().execute(async (trx) => {
    const undone = await trx
      .updateTable('post_likes')
      .set({ is_active: false, updated_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('post_id', '=', post.id)
      .where('is_active', '=', true)
      .returning('post_id')
      .executeTakeFirst();
    if (undone) await emit(trx, 'post.unliked', post.id, {});
  });
}

export async function savePost(userId: number, postPublicId: string): Promise<void> {
  const post = await visiblePost(userId, postPublicId);
  await db.insertInto('saved_posts').values({ user_id: userId, post_id: post.id }).onConflict((oc) => oc.doNothing()).execute();
}

export async function unsavePost(userId: number, postPublicId: string): Promise<void> {
  await db
    .deleteFrom('saved_posts')
    .where('user_id', '=', userId)
    .where('post_id', '=', (eb) => eb.selectFrom('posts').select('id').where('public_id', '=', postPublicId))
    .execute();
}
