// Creates the first admin account and, on an empty database, the starter content.
// Usage: pnpm db:seed   (reads SEED_ADMIN_EMAIL, SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD)

import argon2 from 'argon2';
import { db, type Db } from '../db';
import * as data from './seed-data';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env before seeding`);
  return value;
}

async function seedAdmin() {
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const username = requireEnv('SEED_ADMIN_USERNAME').toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');

  const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (existing) {
    await db.updateTable('users').set({ role: 'admin' }).where('id', '=', existing.id).execute();
    console.log(`Admin ${email} already exists; role confirmed.`);
    return;
  }
  await db
    .insertInto('users')
    .values({ email, username, password_hash: await argon2.hash(password), role: 'admin' })
    .execute();
  console.log(`Created admin ${email}.`);
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

async function seedContent(trx: Db) {
  const fieldId = idLookup(await trx.insertInto('fields').values(data.fields).returning(['id', 'name']).execute(), 'name');
  const topicId = idLookup(await trx.insertInto('topics').values(data.topics).returning(['id', 'name']).execute(), 'name');

  const itemId = idLookup(
    await trx
      .insertInto('learn_items')
      .values(data.learnItems.map(({ topic, ...item }) => ({ ...item, kind: 'text', topic_id: topicId(topic) })))
      .returning(['id', 'title'])
      .execute(),
    'title',
  );

  const { course, externalCourse } = data;
  const { id: courseId } = await trx
    .insertInto('courses')
    .values({ title: course.title, description: course.description })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('course_items')
    .values(course.items.map((title, index) => ({ course_id: courseId, item_id: itemId(title), position: index + 1 })))
    .execute();
  await trx.insertInto('courses').values(externalCourse).execute();

  await trx
    .insertInto('questions')
    .values(
      data.questions.map(({ topic, ...question }) => ({
        ...question,
        topic_id: topicId(topic),
        options: 'options' in question ? question.options : null,
      })),
    )
    .execute();

  const paperId = idLookup(
    await trx
      .insertInto('papers')
      .values(data.papers.map(({ field, prerequisites: _, ...paper }) => ({ ...paper, field_id: fieldId(field) })))
      .returning(['id', 'title'])
      .execute(),
    'title',
  );
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

async function main() {
  await seedAdmin();

  const hasContent = await db.selectFrom('fields').select('id').limit(1).executeTakeFirst();
  if (hasContent) {
    console.log('Content already exists; skipping starter content.');
  } else {
    await db.transaction().execute(seedContent);
  }
}

try {
  await main();
} finally {
  await db.destroy();
}
