import { db } from '../../db';
import { notFound } from '../../lib/errors';

type ContentTable = 'topics' | 'fields' | 'learn_items' | 'courses' | 'questions' | 'papers';

/** Deletes one content row, or throws a 404 naming the resource. */
export async function deleteById(table: ContentTable, id: number, resource: string): Promise<void> {
  const result = await db.deleteFrom(table).where('id', '=', id).executeTakeFirst();
  if (result.numDeletedRows === 0n) throw notFound(resource);
}
