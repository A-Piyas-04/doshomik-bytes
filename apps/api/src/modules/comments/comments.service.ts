import { sql } from 'kysely';
import { db, type Db } from '../../db';
import { isPublished, notBlocked } from '../../db/visibility';
import { badRequest, forbidden, found, notFound } from '../../lib/errors';
import { emit } from '../../lib/outbox';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { visiblePost } from '../posts/posts.service';
import { userSummary } from '../users/user-summary';

/** A thread lives under exactly one post or one paper, named by its public id. */
export type CommentTarget = { postId: string } | { paperId: string };

/**
 * Comments the viewer may see. A deleted comment, or one whose author is gone or suspended, stays
 * as a "[deleted]" placeholder (body and author null) so its replies keep their place. Comments
 * by someone the viewer blocked, or who blocked the viewer, are left out.
 */
function selectComments(viewerId: number) {
  const hidden = sql<boolean>`(c.deleted_at IS NOT NULL OR u.id IS NULL OR u.status <> 'active')`;
  return db
    .selectFrom('comments as c')
    .leftJoin('users as u', 'u.id', 'c.user_id')
    .leftJoin('comments as parent', 'parent.id', 'c.parent_id')
    .leftJoin('posts as post', 'post.id', 'c.post_id')
    .leftJoin('papers as paper', 'paper.id', 'c.paper_id')
    .where((eb) => eb.or([eb('c.user_id', 'is', null), notBlocked(viewerId, 'c.user_id')]))
    .select((eb) => [
      'c.public_id as id',
      'post.public_id as post_id',
      'paper.public_id as paper_id',
      'parent.public_id as parent_id',
      sql<string | null>`CASE WHEN ${hidden} THEN NULL ELSE c.body END`.as('body'),
      sql<unknown>`CASE WHEN ${hidden} THEN NULL ELSE ${userSummary('u')} END`.as('author'),
      hidden.as('is_deleted'),
      'c.created_at',
      eb
        .selectFrom('comments as r')
        .whereRef('r.parent_id', '=', 'c.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('reply_count'),
    ]);
}

/** Top-level comments, oldest first. Replies are fetched per comment. */
export async function listComments(viewerId: number, target: CommentTarget, page: PageQuery) {
  const thread = await resolveThread(db, viewerId, target);
  const query = selectComments(viewerId)
    .where('c.parent_id', 'is', null)
    .where(thread.postId ? 'c.post_id' : 'c.paper_id', '=', (thread.postId ?? thread.paperId)!);
  return fetchPage(query, 'c', page, 'asc');
}

export async function listReplies(viewerId: number, commentPublicId: string, page: PageQuery) {
  const parent = await visibleComment(viewerId, commentPublicId);
  return fetchPage(selectComments(viewerId).where('c.parent_id', '=', parent.id), 'c', page, 'asc');
}

/** Adds a comment, or a reply with `parentId`. Counting and notifications happen in the worker. */
export async function addComment(userId: number, target: CommentTarget, body: string, parentPublicId?: string) {
  const commentPublicId = await db.transaction().execute(async (trx) => {
    const thread = await resolveThread(trx, userId, target);

    let parentId: number | null = null;
    if (parentPublicId) {
      const parent = await trx
        .selectFrom('comments')
        .select(['id', 'post_id', 'paper_id', 'deleted_at'])
        .where('public_id', '=', parentPublicId)
        .executeTakeFirst();
      if (!parent || parent.post_id !== thread.postId || parent.paper_id !== thread.paperId || parent.deleted_at) {
        throw badRequest('You can only reply to a comment in the same thread', 'INVALID_PARENT');
      }
      parentId = parent.id;
    }

    const comment = await trx
      .insertInto('comments')
      .values({ user_id: userId, post_id: thread.postId, paper_id: thread.paperId, parent_id: parentId, body })
      .returning(['id', 'public_id'])
      .executeTakeFirstOrThrow();
    await emit(trx, 'comment.created', comment.id, {});
    return comment.public_id;
  });

  return selectComments(userId).where('c.public_id', '=', commentPublicId).executeTakeFirstOrThrow();
}

/** Soft delete: the comment becomes a "[deleted]" placeholder. Authors can delete their own. */
export async function deleteComment(userId: number, commentPublicId: string): Promise<void> {
  const comment = found(
    await db.selectFrom('comments').select(['id', 'user_id']).where('public_id', '=', commentPublicId).where('deleted_at', 'is', null).executeTakeFirst(),
    'Comment',
  );
  if (comment.user_id !== userId) throw forbidden('You can only delete your own comments');
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('comments').set({ deleted_at: new Date() }).where('id', '=', comment.id).execute();
    await emit(trx, 'comment.deleted', comment.id, {});
  });
}

/** A comment whose thread the viewer may see, or 404. */
async function visibleComment(viewerId: number, commentPublicId: string) {
  const comment = found(
    await db
      .selectFrom('comments as c')
      .leftJoin('posts as post', 'post.id', 'c.post_id')
      .leftJoin('papers as paper', 'paper.id', 'c.paper_id')
      .select(['c.id', 'post.public_id as post_public_id', 'paper.public_id as paper_public_id'])
      .where('c.public_id', '=', commentPublicId)
      .executeTakeFirst(),
    'Comment',
  );
  await resolveThread(db, viewerId, comment.post_public_id ? { postId: comment.post_public_id } : { paperId: comment.paper_public_id! });
  return comment;
}

/** The internal ids of a thread the viewer may see: a visible post or a published paper. */
async function resolveThread(trx: Db, viewerId: number, target: CommentTarget) {
  if ('postId' in target) {
    const post = await visiblePost(viewerId, target.postId);
    return { postId: post.id, paperId: null };
  }
  const paper = await trx
    .selectFrom('papers as p')
    .select('p.id')
    .where('p.public_id', '=', target.paperId)
    .where(isPublished('p'))
    .executeTakeFirst();
  if (!paper) throw notFound('Paper');
  return { postId: null, paperId: paper.id };
}
