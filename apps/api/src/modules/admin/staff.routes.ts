import { USER_ROLES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db';
import { containsPattern } from '../../db/search';
import { audit } from '../../lib/audit';
import { badRequest, found } from '../../lib/errors';
import { emitSearchSync } from '../../lib/outbox';
import { fetchPage, pageQuery } from '../../lib/pagination';
import { idParams, text } from '../../lib/validation';
import { userSummary } from '../users/user-summary';
import { suspendUser } from '../users/users.service';

// Admin-only: account status, staff roles and the audit log.

export const staffRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Finds accounts by username or email, in any status. */
  app.get('/users', { schema: { querystring: pageQuery.extend({ q: text(100).optional() }) } }, async (request) => {
    const { q, ...page } = request.query;
    const query = db
      .selectFrom('users as u')
      .select(['u.public_id as id', 'u.username', 'u.email', 'u.role', 'u.status', 'u.created_at', 'u.deleted_at'])
      .$if(q !== undefined, (qb) => qb.where((eb) => eb.or([eb('u.username', 'ilike', containsPattern(q!)), eb('u.email', 'ilike', containsPattern(q!))])));
    return fetchPage(query, 'u', page);
  });

  app.put(
    '/users/:id/status',
    { schema: { params: idParams, body: z.object({ status: z.enum(['active', 'suspended']) }) } },
    async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const user = found(
          await trx.selectFrom('users').select(['id', 'status']).where('public_id', '=', request.params.id).executeTakeFirst(),
          'User',
        );
        if (user.id === request.auth.userId) throw badRequest('You cannot change your own status');
        if (user.status === 'deleted') throw badRequest('This account is being deleted');

        if (request.body.status === 'suspended') await suspendUser(trx, user.id);
        else {
          await trx.updateTable('users').set({ status: 'active', updated_at: new Date() }).where('id', '=', user.id).execute();
          await emitSearchSync(trx, 'user', user.id);
        }
        await audit(trx, request, { action: `user.${request.body.status === 'suspended' ? 'suspend' : 'reactivate'}`, entityType: 'user', entityId: user.id });
      });
      return reply.status(204).send();
    },
  );

  /** Makes someone a moderator or admin, or a regular user again. Staff then need two-factor sign-in. */
  app.put(
    '/users/:id/role',
    { schema: { params: idParams, body: z.object({ role: z.enum(USER_ROLES) }) } },
    async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const user = found(await trx.selectFrom('users').select('id').where('public_id', '=', request.params.id).executeTakeFirst(), 'User');
        if (user.id === request.auth.userId) throw badRequest('You cannot change your own role');
        await trx.updateTable('users').set({ role: request.body.role, updated_at: new Date() }).where('id', '=', user.id).execute();
        await audit(trx, request, { action: 'user.role', entityType: 'user', entityId: user.id, changes: request.body });
      });
      return reply.status(204).send();
    },
  );

  app.get('/audit-log', { schema: { querystring: pageQuery } }, async (request) => {
    const query = db
      .selectFrom('audit_log as al')
      .leftJoin('users as actor', 'actor.id', 'al.actor_id')
      .select(['al.id', 'al.action', 'al.entity_type', 'al.entity_id', 'al.changes', 'al.ip', 'al.created_at', userSummary('actor').as('actor')]);
    return fetchPage(query, 'al', request.query);
  });
};
