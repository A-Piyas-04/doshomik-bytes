import { sql } from 'kysely';
import { jsonBuildObject } from 'kysely/helpers/postgres';

/** `{ id, username, display_name, avatar_url }` for the user aliased `table`, with the public id as `id`. */
export const userSummary = (table: string) =>
  jsonBuildObject({
    id: sql.ref<string>(`${table}.public_id`),
    username: sql.ref<string>(`${table}.username`),
    display_name: sql.ref<string | null>(`${table}.display_name`),
    avatar_url: sql.ref<string | null>(`${table}.avatar_url`),
  });

export interface UserSummary {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}
