import { REPORT_STATUSES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db, type Db } from '../../db';
import { audit } from '../../lib/audit';
import { badRequest, conflict, found } from '../../lib/errors';
import { emit, emitSearchSync } from '../../lib/outbox';
import { fetchPage, pageQuery } from '../../lib/pagination';
import { numericIdParams } from '../../lib/validation';
import { userSummary } from '../users/user-summary';
import { suspendUser } from '../users/users.service';

const ResolveBody = z.object({
  // dismiss: no action. remove_content: hide the post or comment. suspend_user: suspend the user, or the author.
  action: z.enum(['dismiss', 'remove_content', 'suspend_user']),
});

/** What a report points at, for the moderator to judge without opening the app. */
async function targetPreview(type: string, targetId: number) {
  if (type === 'user') {
    return db.selectFrom('users as u').select(['u.public_id as id', 'u.username', 'u.status', 'u.bio']).where('u.id', '=', targetId).executeTakeFirst();
  }
  if (type === 'post') {
    return db
      .selectFrom('posts as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .select(['p.public_id as id', 'p.type', 'p.caption', 'p.status', 'p.deleted_at', userSummary('u').as('author')])
      .where('p.id', '=', targetId)
      .executeTakeFirst();
  }
  return db
    .selectFrom('comments as c')
    .leftJoin('users as u', 'u.id', 'c.user_id')
    .select(['c.public_id as id', 'c.body', 'c.deleted_at', userSummary('u').as('author')])
    .where('c.id', '=', targetId)
    .executeTakeFirst();
}

/** The account behind a report's target: the user itself, or the author of the post or comment. */
async function responsibleUserId(trx: Db, type: string, targetId: number): Promise<number | null> {
  if (type === 'user') return targetId;
  const table = type === 'post' ? 'posts' : 'comments';
  const row = await trx.selectFrom(table).select('user_id').where('id', '=', targetId).executeTakeFirst();
  return row?.user_id ?? null;
}

export const moderationRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The queue, oldest first. */
  app.get(
    '/reports',
    { schema: { querystring: pageQuery.extend({ status: z.enum(REPORT_STATUSES).default('open') }) } },
    async (request) => {
      const { status, ...page } = request.query;
      const query = db
        .selectFrom('reports as r')
        .leftJoin('users as reporter', 'reporter.id', 'r.reporter_id')
        .leftJoin('users as reviewer', 'reviewer.id', 'r.reviewed_by')
        .where('r.status', '=', status)
        .select([
          'r.id',
          'r.target_type',
          'r.target_id',
          'r.reason',
          'r.details',
          'r.status',
          'r.created_at',
          'r.reviewed_at',
          'reporter.username as reporter',
          'reviewer.username as reviewed_by',
        ]);
      const result = await fetchPage(query, 'r', page, 'asc');
      const items = await Promise.all(
        result.items.map(async ({ target_id, ...report }) => ({ ...report, target: (await targetPreview(report.target_type, target_id)) ?? null })),
      );
      return { items, next_cursor: result.next_cursor };
    },
  );

  /** Resolves a report and every other open report on the same target. */
  app.post('/reports/:id/resolve', { schema: { params: numericIdParams, body: ResolveBody } }, async (request, reply) => {
    const { action } = request.body;
    await db.transaction().execute(async (trx) => {
      const report = found(await trx.selectFrom('reports').selectAll().where('id', '=', request.params.id).executeTakeFirst(), 'Report');
      if (report.status !== 'open') throw conflict('This report is already resolved', 'REPORT_RESOLVED');

      if (action === 'remove_content') {
        if (report.target_type === 'user') throw badRequest('Users cannot be removed; suspend them instead');
        if (report.target_type === 'post') {
          await trx.updateTable('posts').set({ status: 'removed', updated_at: new Date() }).where('id', '=', report.target_id).execute();
          await emitSearchSync(trx, 'post', report.target_id);
        } else {
          await trx.updateTable('comments').set({ deleted_at: new Date() }).where('id', '=', report.target_id).execute();
          await emit(trx, 'comment.deleted', report.target_id, {});
        }
      }
      if (action === 'suspend_user') {
        const userId = await responsibleUserId(trx, report.target_type, report.target_id);
        if (userId === null) throw badRequest('That account no longer exists');
        await suspendUser(trx, userId);
      }

      await trx
        .updateTable('reports')
        .set({ status: action === 'dismiss' ? 'dismissed' : 'actioned', reviewed_by: request.auth.userId, reviewed_at: new Date() })
        .where('target_type', '=', report.target_type)
        .where('target_id', '=', report.target_id)
        .where('status', '=', 'open')
        .execute();
      await audit(trx, request, { action: `report.${action}`, entityType: report.target_type, entityId: report.target_id, changes: { report_id: report.id } });
    });
    return reply.status(204).send();
  });
};
