import type { NotificationType } from '@doshomik/shared';
import { db, type Db } from '../../db';
import { notFound } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { userSummary } from '../users/user-summary';

/** Records an alert. Pass the transaction of the action that caused it. Your own actions never notify you. */
export async function notify(
  trx: Db,
  alert: { userId: number; actorId: number; type: NotificationType; postId?: number | null; commentId?: number | null },
): Promise<void> {
  if (alert.userId === alert.actorId) return;
  await trx
    .insertInto('notifications')
    .values({
      user_id: alert.userId,
      actor_id: alert.actorId,
      type: alert.type,
      post_id: alert.postId ?? null,
      comment_id: alert.commentId ?? null,
    })
    .execute();
}

/** Newest first. `paper_id` is set for replies in a paper discussion, so the app can open the paper. */
export function listNotifications(userId: number, page: PageQuery) {
  const query = db
    .selectFrom('notifications as n')
    .innerJoin('users as a', 'a.id', 'n.actor_id')
    .leftJoin('comments as c', 'c.id', 'n.comment_id')
    .where('n.user_id', '=', userId)
    .select([
      'n.id',
      'n.type',
      'n.post_id',
      'n.comment_id',
      'c.paper_id',
      'n.is_read',
      'n.created_at',
      userSummary('a').as('actor'),
    ]);
  return fetchPage(query, 'n', page);
}

export async function countUnread(userId: number): Promise<number> {
  const { count } = await db
    .selectFrom('notifications')
    .where('user_id', '=', userId)
    .where('is_read', '=', false)
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return count;
}

export async function markRead(userId: number, notificationId: number): Promise<void> {
  const result = await db
    .updateTable('notifications')
    .set({ is_read: true })
    .where('id', '=', notificationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw notFound('Notification');
}
