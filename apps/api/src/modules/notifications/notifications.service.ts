import { sql } from 'kysely';
import { db } from '../../db';
import { isActiveUser, notBlocked } from '../../db/visibility';
import { notFound } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { userSummary } from '../users/user-summary';

// The worker creates notifications (worker/notify.ts). The API only reads and marks them.

/** Alerts whose actor is still active and not blocked either way. */
function selectNotifications(userId: number) {
  return db
    .selectFrom('notifications as n')
    .innerJoin('users as a', 'a.id', 'n.actor_id')
    .where('n.user_id', '=', userId)
    .where(isActiveUser('a'))
    .where(notBlocked(userId, 'a.id'));
}

/** Newest first. `paper_id` is set for replies in a paper discussion, so the app can open the paper. */
export function listNotifications(userId: number, page: PageQuery) {
  const query = selectNotifications(userId)
    .leftJoin('posts as p', 'p.id', 'n.post_id')
    .leftJoin('comments as c', 'c.id', 'n.comment_id')
    .leftJoin('papers as paper', 'paper.id', 'c.paper_id')
    .select([
      'n.public_id as id',
      'n.type',
      'p.public_id as post_id',
      'c.public_id as comment_id',
      'paper.public_id as paper_id',
      'n.is_read',
      'n.created_at',
      userSummary('a').as('actor'),
    ]);
  return fetchPage(query, 'n', page);
}

export async function countUnread(userId: number): Promise<number> {
  // Written as a literal "NOT n.is_read" so it matches notifications_unread_idx's predicate.
  const { count } = await selectNotifications(userId)
    .where(sql<boolean>`NOT n.is_read`)
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return count;
}

export async function markRead(userId: number, notificationPublicId: string): Promise<void> {
  const result = await db
    .updateTable('notifications')
    .set({ is_read: true })
    .where('public_id', '=', notificationPublicId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw notFound('Notification');
}
