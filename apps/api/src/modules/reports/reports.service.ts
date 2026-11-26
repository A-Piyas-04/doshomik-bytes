import type { ReportReason, ReportTargetType } from '@doshomik/shared';
import { db } from '../../db';
import { isActiveUser } from '../../db/visibility';
import { badRequest, HttpError, notFound } from '../../lib/errors';
import { visibleComment } from '../comments/comments.service';
import { visiblePost } from '../posts/posts.service';
import { visibleTrailId } from '../trails/trails.service';

/**
 * Resolves what a user may report to its internal id. reports.target_id has no foreign key (it
 * points at users, posts, comments or trails, and must outlive its target), so this is where a
 * target is checked: it exists in the table its type names, and the reporter may see it.
 *   user    an active account other than the reporter's own (blocked users can still be reported)
 *   post    a post the reporter can see
 *   comment a live comment in a thread the reporter can see (also by someone the reporter blocked)
 *   trail   a published trail the reporter can see, or their own
 */
async function targetId(reporterId: number, type: ReportTargetType, publicId: string): Promise<number> {
  if (type === 'post') return (await visiblePost(reporterId, publicId)).id;
  if (type === 'trail') return visibleTrailId(reporterId, publicId);

  if (type === 'comment') {
    // A hidden thread is reported as a missing comment, not a missing post or paper.
    const comment = await visibleComment(reporterId, publicId).catch((error: unknown) => {
      throw error instanceof HttpError && error.statusCode === 404 ? notFound('Comment') : error;
    });
    if (comment.deleted_at) throw notFound('Comment');
    return comment.id;
  }

  const user = await db.selectFrom('users as u').select('u.id').where('u.public_id', '=', publicId).where(isActiveUser('u')).executeTakeFirst();
  if (!user) throw notFound('User');
  if (user.id === reporterId) throw badRequest('You cannot report yourself', 'SELF_REPORT');
  return user.id;
}

/** Files a report for the moderation queue. Reporting the same thing twice keeps one open report. */
export async function createReport(
  reporterId: number,
  input: { target_type: ReportTargetType; target_id: string; reason: ReportReason; details: string | null },
): Promise<{ status: 'open'; created: boolean }> {
  const target = await targetId(reporterId, input.target_type, input.target_id);

  const existing = await db
    .selectFrom('reports')
    .select('id')
    .where('reporter_id', '=', reporterId)
    .where('target_type', '=', input.target_type)
    .where('target_id', '=', target)
    .where('status', '=', 'open')
    .executeTakeFirst();
  if (existing) return { status: 'open', created: false };

  await db
    .insertInto('reports')
    .values({ reporter_id: reporterId, target_type: input.target_type, target_id: target, reason: input.reason, details: input.details })
    .execute();
  return { status: 'open', created: true };
}
