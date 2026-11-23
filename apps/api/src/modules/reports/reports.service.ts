import type { ReportReason, ReportTargetType } from '@doshomik/shared';
import { db } from '../../db';
import { isActiveUser } from '../../db/visibility';
import { notFound } from '../../lib/errors';
import { visiblePost } from '../posts/posts.service';
import { visibleTrailId } from '../trails/trails.service';

/** Resolves what a user may report: an active user, a post or trail they can see, or a live comment. */
async function targetId(reporterId: number, type: ReportTargetType, publicId: string): Promise<number> {
  if (type === 'post') return (await visiblePost(reporterId, publicId)).id;
  if (type === 'trail') return visibleTrailId(reporterId, publicId);

  const row =
    type === 'user'
      ? await db.selectFrom('users as u').select('u.id').where('u.public_id', '=', publicId).where(isActiveUser('u')).executeTakeFirst()
      : await db.selectFrom('comments').select('id').where('public_id', '=', publicId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!row) throw notFound(type === 'user' ? 'User' : 'Comment');
  return row.id;
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
