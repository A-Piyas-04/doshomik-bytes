import { CONTENT_STATUSES, type ContentStatus } from '@doshomik/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, type Db } from '../../db';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { emitSearchSync, type SearchEntity } from '../../lib/outbox';
import { pageQuery } from '../../lib/pagination';
import { idParams } from '../../lib/validation';

// Shared pieces of the content CMS: the draft → published → archived lifecycle, and turning the
// public ids and slugs in request bodies into internal ids.

export type PublishableTable = 'papers' | 'courses' | 'learn_items' | 'questions' | 'quizzes';

const ENTITY: Record<PublishableTable, string> = {
  papers: 'paper',
  courses: 'course',
  learn_items: 'learn_item',
  questions: 'question',
  quizzes: 'quiz',
};
const LABEL: Record<PublishableTable, string> = {
  papers: 'Paper',
  courses: 'Course',
  learn_items: 'Learn item',
  questions: 'Question',
  quizzes: 'Quiz',
};
const SEARCH_ENTITY: Partial<Record<PublishableTable, SearchEntity>> = {
  papers: 'paper',
  courses: 'course',
  learn_items: 'learn_item',
};
const STATUS_ACTION: Record<ContentStatus, string> = { draft: 'unpublish', published: 'publish', archived: 'archive' };

/** For admin list endpoints: `?status=draft` and the usual paging. */
export const adminListQuery = pageQuery.extend({ status: z.enum(CONTENT_STATUSES).optional() });

/** Records a content change for search, when that kind of content is searchable. */
export async function syncSearch(trx: Db, table: PublishableTable, id: number): Promise<void> {
  const entity = SEARCH_ENTITY[table];
  if (entity) await emitSearchSync(trx, entity, id);
}

/**
 * Registers PUT /<path>/:id/status (draft, published or archived) and DELETE /<path>/:id.
 * Publishing stamps published_at the first time. Both actions are written to the audit log.
 */
export function lifecycleRoutes(path: string, table: PublishableTable): FastifyPluginAsyncZod {
  return async (app) => {
    app.put(
      `${path}/:id/status`,
      { schema: { params: idParams, body: z.object({ status: z.enum(CONTENT_STATUSES) }) } },
      async (request, reply) => {
        await setStatus(request, table, request.params.id, request.body.status);
        return reply.status(204).send();
      },
    );

    app.delete(`${path}/:id`, { schema: { params: idParams } }, async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const row = await sql<{ id: number }>`DELETE FROM ${sql.table(table)} WHERE public_id = ${request.params.id} RETURNING id`.execute(trx);
        const id = row.rows[0]?.id;
        if (id === undefined) throw notFound(LABEL[table]);
        await syncSearch(trx, table, id);
        await audit(trx, request, { action: `${ENTITY[table]}.delete`, entityType: ENTITY[table], entityId: id });
      });
      return reply.status(204).send();
    });
  };
}

async function setStatus(request: FastifyRequest, table: PublishableTable, publicId: string, status: ContentStatus) {
  // quizzes has no published_at or updated_by column.
  const tracked = table !== 'quizzes';
  await db.transaction().execute(async (trx) => {
    const result = await sql<{ id: number }>`
      UPDATE ${sql.table(table)}
      SET status = ${status}, updated_at = now()
        ${tracked ? sql`, updated_by = ${request.auth.userId}, published_at = CASE WHEN ${status} = 'published' THEN coalesce(published_at, now()) ELSE published_at END` : sql``}
      WHERE public_id = ${publicId}
      RETURNING id`.execute(trx);
    const id = result.rows[0]?.id;
    if (id === undefined) throw notFound(LABEL[table]);
    await syncSearch(trx, table, id);
    await audit(trx, request, { action: `${ENTITY[table]}.${STATUS_ACTION[status]}`, entityType: ENTITY[table], entityId: id });
  });
}

/** The internal id of the content row with this public id, or 404. */
export async function contentId(trx: Db, table: PublishableTable, publicId: string): Promise<number> {
  const result = await sql<{ id: number }>`SELECT id FROM ${sql.table(table)} WHERE public_id = ${publicId}`.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw notFound(LABEL[table]);
  return id;
}

/** Internal ids for public ids, in the same order. Any unknown id is a 400 naming it. */
export async function idsInOrder(trx: Db, table: PublishableTable, publicIds: string[]): Promise<number[]> {
  if (publicIds.length === 0) return [];
  const result = await sql<{ id: number; public_id: string }>`
    SELECT id, public_id FROM ${sql.table(table)} WHERE public_id IN (${sql.join(publicIds)})`.execute(trx);
  const byPublicId = new Map(result.rows.map((row) => [row.public_id, row.id]));
  return publicIds.map((publicId) => {
    const id = byPublicId.get(publicId);
    if (id === undefined) throw badRequest(`Unknown ${LABEL[table].toLowerCase()}: ${publicId}`, 'UNKNOWN_REFERENCE');
    return id;
  });
}

/** Topic or field id by slug; undefined stays undefined and null stays null (for PATCH bodies). */
export async function slugToId<T extends string | null | undefined>(
  trx: Db,
  table: 'topics' | 'fields',
  slug: T,
): Promise<T extends string ? number : T> {
  if (slug === undefined || slug === null) return slug as never;
  const row = await trx.selectFrom(table).select('id').where('slug', '=', slug).executeTakeFirst();
  if (!row) throw badRequest(`Unknown ${table === 'topics' ? 'topic' : 'field'}: ${slug}`, 'UNKNOWN_REFERENCE');
  return row.id as never;
}

/** A team-content upload (purpose learn or paper_figure) by public id; undefined and null pass through. */
export async function contentMediaId<T extends string | null | undefined>(trx: Db, mediaPublicId: T): Promise<T extends string ? number : T> {
  if (mediaPublicId === undefined || mediaPublicId === null) return mediaPublicId as never;
  const asset = await trx
    .selectFrom('media_assets')
    .select(['id', 'purpose', 'status'])
    .where('public_id', '=', mediaPublicId)
    .executeTakeFirst();
  if (!asset || asset.purpose !== 'learn') throw badRequest('media_id must be an upload with purpose "learn"', 'UNKNOWN_REFERENCE');
  if (asset.status === 'failed' || asset.status === 'uploading') throw badRequest('Finish the upload first', 'MEDIA_NOT_READY');
  return asset.id as never;
}
