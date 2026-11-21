import { sql } from 'kysely';
import { jsonBuildObject } from 'kysely/helpers/postgres';

/** `{ id, username, display_name, avatar_url }` for the user aliased as `table`: post and comment authors, notification actors. */
export const userSummary = (table: string) =>
  jsonBuildObject({
    id: sql.ref<number>(`${table}.id`),
    username: sql.ref<string>(`${table}.username`),
    display_name: sql.ref<string | null>(`${table}.display_name`),
    avatar_url: sql.ref<string | null>(`${table}.avatar_url`),
  });
