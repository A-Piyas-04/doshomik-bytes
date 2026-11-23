import type { ContentLang } from '@doshomik/shared';
import { sql } from 'kysely';
import { db, type Db } from '../../db';
import { canSeeContentOf, isPublished } from '../../db/visibility';
import { badRequest, conflict, forbidden, found, notFound } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { selectPaperCards } from '../research/research.service';
import { userSummary } from '../users/user-summary';
import { visibleUserId } from '../users/users.service';

// A7: reading paths that users make: papers from the collection, in order, one line per step.
// Published trails follow the author's visibility, like posts: hidden when either side blocked
// the other, when the author is inactive, or (private author) from anyone but accepted followers.
// Authors see their own drafts and removed trails.

/** Fewer than this many steps is not a path. */
const MIN_PUBLISHED_STEPS = 2;

export interface TrailItemInput {
  paper_id: string;
  note?: string | null;
}

function selectTrails(viewerId: number) {
  return db
    .selectFrom('trails as tr')
    .innerJoin('users as u', 'u.id', 'tr.creator_id')
    .leftJoin('fields as f', 'f.id', 'tr.field_id')
    .where((eb) => eb.or([eb.and([eb('tr.status', '=', 'published'), canSeeContentOf(viewerId, 'u')]), eb('tr.creator_id', '=', viewerId)]))
    .select([
      'tr.public_id as id',
      'tr.title',
      'tr.description',
      'tr.lang',
      'tr.status',
      sql<{ slug: string; name: string } | null>`CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('slug', f.slug, 'name', f.name) END`.as('field'),
      userSummary('u').as('creator'),
      sql<number>`(SELECT count(*)::int FROM trail_items ti JOIN papers p ON p.id = ti.paper_id
        WHERE ti.trail_id = tr.id AND p.status = 'published')`.as('paper_count'),
      'tr.published_at',
      'tr.created_at',
      'tr.updated_at',
    ]);
}

/** Published trails, newest first, optionally for one chip or language (Research and Learn). */
export function listTrails(viewerId: number, filter: { field?: string; lang?: ContentLang }, page: PageQuery) {
  const query = selectTrails(viewerId)
    .where('tr.status', '=', 'published')
    .$if(filter.field !== undefined, (qb) => qb.where('f.slug', '=', filter.field!))
    .$if(filter.lang !== undefined, (qb) => qb.where('tr.lang', '=', filter.lang!));
  return fetchPage(query, 'tr', page);
}

/** A user's trails: published ones, plus drafts and removed ones when it is the viewer's own list. */
export async function listUserTrails(viewerId: number, userPublicId: string, page: PageQuery) {
  const ownerId = await visibleUserId(viewerId, userPublicId);
  const query = selectTrails(viewerId)
    .where('tr.creator_id', '=', ownerId)
    .$if(ownerId !== viewerId, (qb) => qb.where('tr.status', '=', 'published'));
  return fetchPage(query, 'tr', page);
}

/** A trail with its published papers in order, numbered 1..n, each with the author's note. */
export async function getTrail(viewerId: number, trailPublicId: string) {
  const trail = found(await selectTrails(viewerId).select('tr.id as internal_id').where('tr.public_id', '=', trailPublicId).executeTakeFirst(), 'Trail');
  const rows = await selectPaperCards(viewerId)
    .innerJoin('trail_items as ti', 'ti.paper_id', 'p.id')
    .where('ti.trail_id', '=', trail.internal_id)
    .select('ti.note')
    .orderBy('ti.position')
    .execute();
  const { internal_id: _, ...publicTrail } = trail;
  return { ...publicTrail, steps: rows.map(({ note, ...paper }, index) => ({ step: index + 1, note, paper })) };
}

/** The internal id of a trail the viewer may see (for reports), or 404. */
export async function visibleTrailId(viewerId: number, trailPublicId: string): Promise<number> {
  const row = await selectTrails(viewerId).select('tr.id as internal_id').where('tr.public_id', '=', trailPublicId).executeTakeFirst();
  return found(row, 'Trail').internal_id;
}

/** The viewer's own trail, for changes. 404 if it doesn't exist, 403 if it is someone else's. */
async function ownTrail(trx: Db, userId: number, trailPublicId: string) {
  const trail = found(
    await trx.selectFrom('trails').select(['id', 'creator_id', 'status']).where('public_id', '=', trailPublicId).forUpdate().executeTakeFirst(),
    'Trail',
  );
  if (trail.creator_id !== userId) throw forbidden('You can only change your own trails');
  if (trail.status === 'removed') throw conflict('A moderator removed this trail', 'TRAIL_REMOVED');
  return trail;
}

/** Replaces the trail's steps. Only published papers can be added. */
async function writeItems(trx: Db, trailId: number, items: TrailItemInput[]): Promise<void> {
  const publicIds = items.map((item) => item.paper_id);
  const papers = publicIds.length
    ? await trx.selectFrom('papers as p').select(['p.id', 'p.public_id']).where('p.public_id', 'in', publicIds).where(isPublished('p')).execute()
    : [];
  const idOf = new Map(papers.map((paper) => [paper.public_id, paper.id]));
  const unknown = publicIds.filter((id) => !idOf.has(id));
  if (unknown.length) throw badRequest(`Unknown or unpublished papers: ${unknown.join(', ')}`, 'UNKNOWN_REFERENCE');

  await trx.deleteFrom('trail_items').where('trail_id', '=', trailId).execute();
  if (items.length) {
    await trx
      .insertInto('trail_items')
      .values(items.map((item, index) => ({ trail_id: trailId, position: index + 1, paper_id: idOf.get(item.paper_id)!, note: item.note ?? null })))
      .execute();
  }
}

async function requirePublishable(trx: Db, trailId: number): Promise<void> {
  const { n } = await trx
    .selectFrom('trail_items')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('trail_id', '=', trailId)
    .executeTakeFirstOrThrow();
  if (Number(n) < MIN_PUBLISHED_STEPS) throw badRequest(`A trail needs at least ${MIN_PUBLISHED_STEPS} papers before it is published`, 'TRAIL_TOO_SHORT');
}

export async function createTrail(
  userId: number,
  input: { title: string; description: string | null; lang: ContentLang; field?: string; items: TrailItemInput[]; publish: boolean },
) {
  const trailPublicId = await db.transaction().execute(async (trx) => {
    const fieldId = input.field ? await fieldIdOf(trx, input.field) : null;
    const trail = await trx
      .insertInto('trails')
      .values({
        creator_id: userId,
        title: input.title,
        description: input.description,
        lang: input.lang,
        field_id: fieldId,
        status: input.publish ? 'published' : 'draft',
        published_at: input.publish ? new Date() : null,
      })
      .returning(['id', 'public_id'])
      .executeTakeFirstOrThrow();
    await writeItems(trx, trail.id, input.items);
    if (input.publish) await requirePublishable(trx, trail.id);
    return trail.public_id;
  });
  return getTrail(userId, trailPublicId);
}

export async function updateTrail(
  userId: number,
  trailPublicId: string,
  changes: { title?: string; description?: string | null; lang?: ContentLang; field?: string | null },
) {
  await db.transaction().execute(async (trx) => {
    const trail = await ownTrail(trx, userId, trailPublicId);
    const { field, ...rest } = changes;
    await trx
      .updateTable('trails')
      .set({ ...rest, ...(field !== undefined ? { field_id: field === null ? null : await fieldIdOf(trx, field) } : {}), updated_at: new Date() })
      .where('id', '=', trail.id)
      .execute();
  });
  return getTrail(userId, trailPublicId);
}

export async function setTrailItems(userId: number, trailPublicId: string, items: TrailItemInput[]) {
  await db.transaction().execute(async (trx) => {
    const trail = await ownTrail(trx, userId, trailPublicId);
    await writeItems(trx, trail.id, items);
    if (trail.status === 'published') await requirePublishable(trx, trail.id);
    await trx.updateTable('trails').set({ updated_at: new Date() }).where('id', '=', trail.id).execute();
  });
  return getTrail(userId, trailPublicId);
}

/** Publish or move back to draft. `removed` is a moderator's decision and can't be set here. */
export async function setTrailStatus(userId: number, trailPublicId: string, status: 'draft' | 'published') {
  await db.transaction().execute(async (trx) => {
    const trail = await ownTrail(trx, userId, trailPublicId);
    if (status === 'published') await requirePublishable(trx, trail.id);
    await trx
      .updateTable('trails')
      .set({ status, updated_at: new Date(), published_at: status === 'published' ? sql`coalesce(published_at, now())` : sql`published_at` })
      .where('id', '=', trail.id)
      .execute();
  });
  return getTrail(userId, trailPublicId);
}

export async function deleteTrail(userId: number, trailPublicId: string): Promise<void> {
  const trail = await db.selectFrom('trails').select(['id', 'creator_id']).where('public_id', '=', trailPublicId).executeTakeFirst();
  if (!trail) throw notFound('Trail');
  if (trail.creator_id !== userId) throw forbidden('You can only delete your own trails');
  await db.deleteFrom('trails').where('id', '=', trail.id).execute();
}

async function fieldIdOf(trx: Db, fieldSlug: string): Promise<number> {
  const field = await trx.selectFrom('fields').select('id').where('slug', '=', fieldSlug).executeTakeFirst();
  if (!field) throw badRequest(`Unknown field: ${fieldSlug}`, 'UNKNOWN_REFERENCE');
  return field.id;
}
