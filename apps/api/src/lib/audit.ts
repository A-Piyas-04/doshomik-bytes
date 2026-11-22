import type { FastifyRequest } from 'fastify';
import type { Db } from '../db';

export interface AuditEntry {
  action: string; // e.g. 'paper.publish', 'user.suspend', 'report.action'
  entityType?: string;
  entityId?: number;
  changes?: unknown;
}

/** Records an admin or security action. Pass the transaction of the action itself. */
export async function audit(trx: Db, request: FastifyRequest, entry: AuditEntry): Promise<void> {
  await trx
    .insertInto('audit_log')
    .values({
      actor_id: request.auth?.userId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      changes: entry.changes === undefined ? null : JSON.stringify(entry.changes),
      ip: request.ip,
    })
    .execute();
}
