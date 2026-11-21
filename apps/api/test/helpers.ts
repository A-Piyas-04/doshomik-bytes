import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { db } from '../src/db';

export type App = Awaited<ReturnType<typeof buildApp>>;

export interface TestUser {
  id: number;
  headers: { authorization: string };
}

const TABLES = [
  'users', 'follows', 'posts', 'post_likes', 'comments', 'notifications', 'topics', 'learn_items',
  'courses', 'course_items', 'questions', 'fields', 'papers', 'paper_prerequisites', 'roadmap_steps', 'user_papers',
];

/** Builds the app once per file and empties every table before each test. */
export function useTestApp(): { app: App } {
  const context = {} as { app: App };

  beforeAll(async () => {
    context.app = await buildApp();
  });
  beforeEach(async () => {
    await sql`TRUNCATE ${sql.join(TABLES.map((table) => sql.table(table)))} RESTART IDENTITY CASCADE`.execute(db);
  });
  afterAll(async () => {
    await context.app.close();
    await db.destroy();
  });

  return context;
}

export async function createUser(app: App, username: string, options: { admin?: boolean } = {}): Promise<TestUser> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: `${username}@example.com`, username, password: 'password123' },
  });
  const { token, user } = response.json();
  if (options.admin) await db.updateTable('users').set({ role: 'admin' }).where('id', '=', user.id).execute();
  return { id: user.id, headers: { authorization: `Bearer ${token}` } };
}
