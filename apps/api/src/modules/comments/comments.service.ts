import { db } from '../../db';
import { badRequest, found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { notify } from '../notifications/notifications.service';
import { userSummary } from '../users/user-summary';

/** A comment thread lives under exactly one post or one paper. */
export type CommentTarget = { postId: number } | { paperId: number };

function selectComments() {
  return db
    .selectFrom('comments as c')
    .innerJoin('users as u', 'u.id', 'c.user_id')
    .select((eb) => [
      'c.id',
      'c.post_id',
      'c.paper_id',
      'c.parent_id',
      'c.body',
      'c.created_at',
      userSummary('u').as('author'),
      eb
        .selectFrom('comments as r')
        .whereRef('r.parent_id', '=', 'c.id')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('reply_count'),
    ]);
}

/** Top-level comments, oldest first. Replies are fetched per comment. */
export async function listComments(target: CommentTarget, page: PageQuery) {
  await assertTargetExists(target);
  const query = selectComments().where('c.parent_id', 'is', null);
  return fetchPage(
    'postId' in target ? query.where('c.post_id', '=', target.postId) : query.where('c.paper_id', '=', target.paperId),
    'c',
    page,
    'asc',
  );
}

export async function listReplies(commentId: number, page: PageQuery) {
  found(await db.selectFrom('comments').select('id').where('id', '=', commentId).executeTakeFirst(), 'Comment');
  return fetchPage(selectComments().where('c.parent_id', '=', commentId), 'c', page, 'asc');
}

/**
 * Adds a comment or, with `parentId`, a reply. A reply notifies the parent's author;
 * any comment on a post also notifies the post's author.
 */
export async function addComment(userId: number, target: CommentTarget, body: string, parentId?: number) {
  const postId = 'postId' in target ? target.postId : null;
  const paperId = 'paperId' in target ? target.paperId : null;

  const commentId = await db.transaction().execute(async (trx) => {
    const postAuthorId = await assertTargetExists(target);

    const parent = parentId
      ? await trx.selectFrom('comments').select(['user_id', 'post_id', 'paper_id']).where('id', '=', parentId).executeTakeFirst()
      : undefined;
    if (parentId && (!parent || parent.post_id !== postId || parent.paper_id !== paperId)) {
      throw badRequest('You can only reply to a comment in the same thread', 'INVALID_PARENT');
    }

    const { id } = await trx
      .insertInto('comments')
      .values({ user_id: userId, post_id: postId, paper_id: paperId, parent_id: parentId ?? null, body })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (parent) {
      await notify(trx, { userId: parent.user_id, actorId: userId, type: 'reply', postId, commentId: id });
    }
    if (postAuthorId !== null && postAuthorId !== parent?.user_id) {
      await notify(trx, { userId: postAuthorId, actorId: userId, type: 'comment', postId, commentId: id });
    }
    return id;
  });

  return selectComments().where('c.id', '=', commentId).executeTakeFirstOrThrow();
}

/** Throws 404 if the post or paper is missing. Returns the post's author, or null for a paper. */
async function assertTargetExists(target: CommentTarget): Promise<number | null> {
  if ('postId' in target) {
    const post = await db.selectFrom('posts').select('user_id').where('id', '=', target.postId).executeTakeFirst();
    return found(post, 'Post').user_id;
  }
  found(await db.selectFrom('papers').select('id').where('id', '=', target.paperId).executeTakeFirst(), 'Paper');
  return null;
}
