import { REEL_MAX_SECONDS, type PostType } from '@doshomik/shared';
import { sql } from 'kysely';
import { db } from '../../db';
import { badRequest, forbidden, found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { storage } from '../../lib/storage';
import { discardUpload, storeUpload, type StoredMedia, type Upload } from '../../lib/uploads';
import { notify } from '../notifications/notifications.service';
import { userSummary } from '../users/user-summary';

/** Posts as every list shows them: author, like and comment counts, and whether the viewer liked it. */
export function selectPosts(viewerId: number) {
  return db
    .selectFrom('posts as p')
    .innerJoin('users as u', 'u.id', 'p.user_id')
    .select((eb) => [
      'p.id',
      'p.type',
      'p.caption',
      'p.media_url',
      'p.duration_seconds',
      'p.created_at',
      userSummary('u').as('author'),
      eb
        .selectFrom('post_likes as l')
        .whereRef('l.post_id', '=', 'p.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('like_count'),
      eb
        .selectFrom('comments as c')
        .whereRef('c.post_id', '=', 'p.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('comment_count'),
      eb
        .exists(
          eb
            .selectFrom('post_likes as l')
            .whereRef('l.post_id', '=', 'p.id')
            .where('l.user_id', '=', viewerId)
            .select(sql.lit(1).as('one')),
        )
        .as('liked_by_me'),
    ]);
}

export async function getPost(viewerId: number, postId: number) {
  return found(await selectPosts(viewerId).where('p.id', '=', postId).executeTakeFirst(), 'Post');
}

/** Home: posts by people the viewer follows, newest first. */
export function listFeed(viewerId: number, page: PageQuery) {
  const query = selectPosts(viewerId)
    .innerJoin('follows as f', 'f.following_id', 'p.user_id')
    .where('f.follower_id', '=', viewerId);
  return fetchPage(query, 'p', page);
}

export function listReels(viewerId: number, page: PageQuery) {
  return fetchPage(selectPosts(viewerId).where('p.type', '=', 'reel'), 'p', page);
}

export function listUserPosts(viewerId: number, userId: number, page: PageQuery) {
  return fetchPage(selectPosts(viewerId).where('p.user_id', '=', userId), 'p', page);
}

/**
 * Text posts need a caption; image posts need one image; reels need one video of at most
 * REEL_MAX_SECONDS. The file is stored before the row is inserted, because the schema
 * requires media_url on image and reel posts.
 */
export async function createPost(
  userId: number,
  input: { type: PostType; caption: string | null; file?: Upload },
) {
  const { type, caption, file } = input;
  let media: StoredMedia | null = null;

  try {
    if (type === 'text') {
      if (file) throw badRequest('Text posts cannot have a file');
      if (!caption) throw badRequest('Text posts need a caption');
    } else {
      const expectedKind = type === 'image' ? 'image' : 'video';
      if (file?.kind !== expectedKind) throw badRequest(`${type === 'image' ? 'Image' : 'Reel'} posts need one ${expectedKind} file`);
      media = await storeUpload(file, 'posts', type === 'reel' ? { maxSeconds: REEL_MAX_SECONDS } : {});
    }
  } finally {
    await discardUpload(file); // also on validation errors, before storeUpload took the file
  }

  try {
    const { id } = await db
      .insertInto('posts')
      .values({
        user_id: userId,
        type,
        caption,
        media_url: media?.url ?? null,
        duration_seconds: media?.durationSeconds ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return getPost(userId, id);
  } catch (error) {
    if (media) await storage.remove(media.url);
    throw error;
  }
}

export async function deletePost(userId: number, postId: number): Promise<void> {
  const post = found(
    await db.selectFrom('posts').select(['user_id', 'media_url']).where('id', '=', postId).executeTakeFirst(),
    'Post',
  );
  if (post.user_id !== userId) throw forbidden('You can only delete your own posts');

  await db.deleteFrom('posts').where('id', '=', postId).execute();
  if (post.media_url) await storage.remove(post.media_url);
}

export async function likePost(userId: number, postId: number): Promise<void> {
  const post = found(await db.selectFrom('posts').select('user_id').where('id', '=', postId).executeTakeFirst(), 'Post');

  await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('post_likes')
      .values({ user_id: userId, post_id: postId })
      .onConflict((oc) => oc.doNothing())
      .returning('post_id')
      .executeTakeFirst();
    if (created) await notify(trx, { userId: post.user_id, actorId: userId, type: 'like', postId });
  });
}

export async function unlikePost(userId: number, postId: number): Promise<void> {
  await db.deleteFrom('post_likes').where('user_id', '=', userId).where('post_id', '=', postId).execute();
}
