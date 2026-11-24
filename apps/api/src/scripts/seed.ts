// Creates the first admin account and, on an empty database, the starter content.
// Usage: pnpm db:seed   (reads SEED_ADMIN_EMAIL, SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD)

import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, type Db } from '../db';
import { slugify } from '../lib/validation';
import * as data from './seed-data';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env before seeding`);
  return value;
}

/** Creates the admin, or confirms the role of an existing account with that email. Returns its id. */
async function seedAdmin(): Promise<number> {
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const username = requireEnv('SEED_ADMIN_USERNAME').toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');

  const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (existing) {
    await db.updateTable('users').set({ role: 'admin' }).where('id', '=', existing.id).execute();
    console.log(`Admin ${email} already exists; role confirmed.`);
    return existing.id;
  }
  const { id } = await db
    .insertInto('users')
    .values({ email, username, password_hash: await argon2.hash(password), role: 'admin', email_verified_at: new Date() })
    .returning('id')
    .executeTakeFirstOrThrow();
  console.log(`Created admin ${email}. Turn on two-factor sign-in (POST /v1/me/2fa/setup) to use the admin API.`);
  return id;
}

/** Maps each inserted row's name or title to its id, failing loudly on a name the seed data doesn't define. */
function idLookup<K extends 'name' | 'title'>(rows: ({ id: number } & Record<K, string>)[], key: K) {
  const ids = new Map<string, number>(rows.map((row) => [row[key], row.id]));
  return (name: string): number => {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`Seed data references unknown "${name}"`);
    return id;
  };
}

async function seedContent(trx: Db, adminId: number) {
  // Starter content goes live at once, credited to the seeded admin.
  const live = { status: 'published', published_at: new Date(), created_by: adminId, updated_by: adminId };
  const withSlug = <T extends { name: string }>(row: T) => ({ ...row, slug: slugify(row.name) });

  const fieldId = idLookup(await trx.insertInto('fields').values(data.fields.map(withSlug)).returning(['id', 'name']).execute(), 'name');
  const topicId = idLookup(await trx.insertInto('topics').values(data.topics.map(withSlug)).returning(['id', 'name']).execute(), 'name');

  const itemId = idLookup(
    await trx
      .insertInto('learn_items')
      .values(data.learnItems.map(({ topic, ...item }) => ({ ...item, ...live, kind: 'text', topic_id: topicId(topic) })))
      .returning(['id', 'title'])
      .execute(),
    'title',
  );

  const { course, externalCourse } = data;
  const { id: courseId } = await trx
    .insertInto('courses')
    .values({ title: course.title, description: course.description, ...live })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('course_items')
    .values(course.items.map((title, index) => ({ course_id: courseId, item_id: itemId(title), position: index + 1 })))
    .execute();
  await trx.insertInto('courses').values({ ...externalCourse, ...live }).execute();

  await trx
    .insertInto('questions')
    .values(
      data.questions.map(({ topic, ...question }) => ({
        ...question,
        ...live,
        topic_id: topicId(topic),
        options: 'options' in question ? question.options : null,
      })),
    )
    .execute();

  const paperId = idLookup(
    await trx
      .insertInto('papers')
      .values(data.papers.map(({ field, prerequisites: _, ...paper }) => ({ ...paper, ...live, field_id: fieldId(field) })))
      .returning(['id', 'title'])
      .execute(),
    'title',
  );
  // English Paper Cards from the summaries, then each paper's search document (migration 005).
  await sql`
    INSERT INTO paper_cards (paper_id, lang, question, key_idea, method_steps, findings, limitations)
    SELECT id, 'en', research_questions[1], main_idea, method_steps, results, limitations FROM papers`.execute(trx);
  await sql`SELECT refresh_paper_search(id) FROM papers`.execute(trx);
  await trx
    .insertInto('paper_prerequisites')
    .values(
      data.papers.flatMap((paper) =>
        paper.prerequisites.map((topic, index) => ({
          paper_id: paperId(paper.title),
          topic_id: topicId(topic),
          position: index + 1,
        })),
      ),
    )
    .execute();

  await trx
    .insertInto('roadmap_steps')
    .values(
      Object.entries(data.roadmaps).flatMap(([field, steps]) =>
        steps.map((step, index) => ({
          field_id: fieldId(field),
          position: index + 1,
          paper_id: paperId(step.paper),
          note: step.note,
        })),
      ),
    )
    .execute();

  console.log(
    `Seeded ${data.fields.length} fields, ${data.topics.length} topics, ${data.learnItems.length} learn items, ` +
      `2 courses, ${data.questions.length} questions and ${data.papers.length} papers.`,
  );
}

/** Ordinary accounts for testing social flows (follow, like, comment) between users. Never in production. */
const DEV_USERS = ['learner1', 'learner2'];
const DEV_USER_PASSWORD = 'devpassword';

async function seedDevUsers() {
  if (process.env.NODE_ENV === 'production') return;
  const passwordHash = await argon2.hash(DEV_USER_PASSWORD);
  const created = await db
    .insertInto('users')
    .values(DEV_USERS.map((username) => ({ username, email: `${username}@doshomik.local`, password_hash: passwordHash, email_verified_at: new Date() })))
    .onConflict((oc) => oc.doNothing())
    .returning('username')
    .execute();
  if (created.length) {
    console.log(`Created dev users ${created.map((u) => u.username).join(', ')} (password "${DEV_USER_PASSWORD}").`);
  }
}

async function main() {
  const adminId = await seedAdmin();
  await seedDevUsers();

  const hasContent = await db.selectFrom('fields').select('id').limit(1).executeTakeFirst();
  if (hasContent) {
    console.log('Content already exists; skipping starter content.');
  } else {
    await db.transaction().execute((trx) => seedContent(trx, adminId));
  }
}

try {
  await main();
} finally {
  await db.destroy();
}
