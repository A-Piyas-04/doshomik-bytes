// Creates the first admin account and, on an empty database, the starter content. Outside
// production it also creates the dev users and sample activity, so every screen of the app has
// real data to show.
// Usage: pnpm db:seed   (reads SEED_ADMIN_EMAIL, SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD)

import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, type Db } from '../db';
import { slugify } from '../lib/validation';
import { createPaperCompanions } from '../modules/research/research.service';
import * as data from './seed-data';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env before seeding`);
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

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

/** Maps a name (or title, or prompt) to its id, failing loudly on one the seed data doesn't define. */
function lookup(rows: { id: number; key: string }[]) {
  const ids = new Map<string, number>(rows.map((row) => [row.key, row.id]));
  return (name: string): number => {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`Seed data references unknown "${name}"`);
    return id;
  };
}

async function seedContent(trx: Db, adminId: number) {
  // Starter content goes live at once, credited to the seeded admin.
  const live = { status: 'published', published_at: new Date(), created_by: adminId, updated_by: adminId };

  const fieldRows = await trx
    .insertInto('fields')
    .values(data.fields.map((field) => ({ ...field, slug: slugify(field.name) })))
    .returning(['id', 'name as key'])
    .execute();
  const fieldId = lookup(fieldRows);

  const topicId = lookup(
    await trx
      .insertInto('topics')
      .values(data.topics.map(({ field, ...topic }) => ({ ...topic, slug: slugify(topic.name), field_id: fieldId(field) })))
      .returning(['id', 'name as key'])
      .execute(),
  );

  const itemId = lookup(
    await trx
      .insertInto('learn_items')
      .values(
        data.learnItems.map((item) =>
          item.kind === 'text'
            ? { ...live, topic_id: topicId(item.topic), title: item.title, kind: 'text', body: item.body }
            : {
                ...live,
                topic_id: topicId(item.topic),
                title: item.title,
                kind: 'video',
                media_url: item.media_url,
                duration_seconds: item.duration_seconds,
                body: item.body ?? null,
              },
        ),
      )
      .returning(['id', 'title as key'])
      .execute(),
  );

  for (const course of data.courses) {
    const { id } = await trx
      .insertInto('courses')
      .values({ title: course.title, description: course.description, field_id: fieldId(course.field), ...live })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('course_items')
      .values(course.items.map((title, index) => ({ course_id: id, item_id: itemId(title), position: index + 1 })))
      .execute();
  }
  await trx
    .insertInto('courses')
    .values(data.externalCourses.map(({ field, ...course }) => ({ ...course, field_id: fieldId(field), ...live })))
    .execute();

  const questionId = lookup(
    await trx
      .insertInto('questions')
      .values(
        data.questions.map(({ topic, ...question }) => ({
          ...question,
          ...live,
          topic_id: topicId(topic),
          options: question.kind === 'mcq' ? question.options : null,
        })),
      )
      .returning(['id', 'prompt as key'])
      .execute(),
  );

  const quizRows: { id: number; key: string }[] = [];
  for (const quiz of data.quizzes) {
    const row = await trx
      .insertInto('quizzes')
      .values({ title: quiz.title, topic_id: topicId(quiz.topic), status: 'published', created_by: adminId })
      .returning(['id', 'title as key'])
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('quiz_questions')
      .values(quiz.questions.map((prompt, index) => ({ quiz_id: row.id, question_id: questionId(prompt), position: index + 1 })))
      .execute();
    quizRows.push(row);
  }
  const quizId = lookup(quizRows);

  // Each paper with its companion rows and its Paper Cards (English always, Bangla for some).
  const paperRows: { id: number; key: string }[] = [];
  for (const paper of data.papers) {
    const row = await trx
      .insertInto('papers')
      .values({
        ...live,
        field_id: fieldId(paper.field),
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        published_on: paper.published_on,
        paper_url: paper.paper_url,
        pdf_url: paper.pdf_url,
        code_url: paper.code_url,
      })
      .returning(['id', 'title as key'])
      .executeTakeFirstOrThrow();
    await createPaperCompanions(trx, row.id, { arxiv_id: paper.arxiv_id });
    for (const [lang, card] of [['en', paper.en], ['bn', paper.bn]] as const) {
      if (!card) continue;
      await trx
        .insertInto('paper_cards')
        .values({
          paper_id: row.id,
          lang,
          question: card.question,
          extra_questions: card.extra_questions ?? [],
          problem: card.problem ?? null,
          key_idea: card.key_idea,
          data_source: card.data_source ?? null,
          method_steps: card.method_steps ?? [],
          findings: card.findings ?? null,
          evaluation: card.evaluation ?? null,
          limitations: card.limitations ?? null,
          takeaway: card.takeaway ?? null,
          glossary: JSON.stringify(card.glossary ?? []),
          updated_by: adminId,
        })
        .execute();
    }
    paperRows.push(row);
  }
  const paperId = lookup(paperRows);
  await sql`SELECT refresh_paper_search(id) FROM papers`.execute(trx);

  await trx
    .insertInto('paper_prerequisites')
    .values(
      data.papers.flatMap((paper) =>
        paper.prerequisites.map((pre, index) => ({
          paper_id: paperId(paper.title),
          topic_id: topicId(pre.topic),
          position: index + 1,
          label: pre.label ?? null,
          why: pre.why,
          learn_item_id: pre.lesson ? itemId(pre.lesson) : null,
          quiz_id: pre.quiz ? quizId(pre.quiz) : null,
        })),
      ),
    )
    .execute();

  await trx
    .insertInto('paper_edges')
    .values(
      data.edges.map((edge) => ({
        citing_paper_id: paperId(edge.citing),
        cited_paper_id: paperId(edge.cited),
        intent: edge.intent,
        is_influential: edge.influential ?? false,
        source: 'staff',
      })),
    )
    .execute();

  await trx
    .insertInto('roadmap_steps')
    .values(
      Object.entries(data.roadmaps).flatMap(([field, steps]) =>
        steps.map((step, index) => ({ field_id: fieldId(field), position: index + 1, paper_id: paperId(step.paper), note: step.note })),
      ),
    )
    .execute();

  console.log(
    `Seeded ${data.fields.length} learn areas, ${data.topics.length} topics, ${data.learnItems.length} learn items, ` +
      `${data.courses.length + data.externalCourses.length} courses, ${data.questions.length} questions, ` +
      `${data.quizzes.length} quizzes and ${data.papers.length} papers.`,
  );
  return { fieldId, topicId, itemId, questionId, paperId };
}

type ContentIds = Awaited<ReturnType<typeof seedContent>>;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

/**
 * Sample social and reading activity between the dev users, so every screen has something to show.
 * "admin" in the seed data means the seeded admin, whatever SEED_ADMIN_USERNAME is.
 */
async function seedDevActivity(trx: Db, ids: ContentIds, adminId: number) {
  const learners = await trx.selectFrom('users').select(['id', 'username as key']).where('username', 'in', DEV_USERS).execute();
  if (learners.length !== DEV_USERS.length) {
    console.log('Dev activity skipped: the dev users are missing.');
    return;
  }
  const userId = lookup([...learners, { id: adminId, key: 'admin' }]);

  for (const [username, profile] of Object.entries(data.devProfiles)) {
    await trx.updateTable('users').set(profile).where('id', '=', userId(username)).execute();
  }

  await trx
    .insertInto('follows')
    .values(data.devFollows.map(([follower, following]) => ({ follower_id: userId(follower), following_id: userId(following), status: 'accepted' })))
    .execute();
  // Stored counters, as the worker would have kept them.
  await sql`UPDATE users u SET
      follower_count  = (SELECT count(*) FROM follows f WHERE f.following_id = u.id AND f.status = 'accepted'),
      following_count = (SELECT count(*) FROM follows f WHERE f.follower_id  = u.id AND f.status = 'accepted')`.execute(trx);

  const postRows: { id: number; key: string }[] = [];
  for (const post of data.devPosts) {
    const row = await trx
      .insertInto('posts')
      .values({
        user_id: userId(post.author),
        type: 'text',
        caption: post.caption,
        topic_id: ids.topicId(post.topic),
        status: 'published',
        created_at: hoursAgo(post.hoursAgo),
        updated_at: hoursAgo(post.hoursAgo),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    postRows.push({ id: row.id, key: post.key });
  }
  const postId = lookup(postRows);

  await trx
    .insertInto('post_likes')
    .values(Object.entries(data.devLikes).flatMap(([username, keys]) => keys.map((key) => ({ user_id: userId(username), post_id: postId(key) }))))
    .execute();

  const commentId = new Map<string, number>(); // "<post>:<author>" → the top-level comment
  for (const comment of data.devComments) {
    const row = await trx
      .insertInto('comments')
      .values({ post_id: postId(comment.post), user_id: userId(comment.author), body: comment.body })
      .returning('id')
      .executeTakeFirstOrThrow();
    commentId.set(`${comment.post}:${comment.author}`, row.id);
    for (const reply of comment.replies ?? []) {
      await trx
        .insertInto('comments')
        .values({ post_id: postId(comment.post), parent_id: row.id, user_id: userId(reply.author), body: reply.body })
        .execute();
    }
  }
  await sql`UPDATE posts p SET
      like_count    = (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id AND l.is_active),
      comment_count = (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)`.execute(trx);

  const discussed = ids.paperId('Attention Is All You Need');
  for (const comment of data.devPaperDiscussion) {
    const row = await trx
      .insertInto('comments')
      .values({ paper_id: discussed, user_id: userId(comment.author), body: comment.body })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const reply of comment.replies ?? []) {
      await trx.insertInto('comments').values({ paper_id: discussed, parent_id: row.id, user_id: userId(reply.author), body: reply.body }).execute();
    }
  }

  for (const trail of data.devTrails) {
    const row = await trx
      .insertInto('trails')
      .values({
        creator_id: userId(trail.author),
        title: trail.title,
        description: trail.description,
        lang: trail.lang,
        field_id: ids.fieldId(trail.field),
        status: trail.publish ? 'published' : 'draft',
        published_at: trail.publish ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('trail_items')
      .values(trail.steps.map((step, index) => ({ trail_id: row.id, position: index + 1, paper_id: ids.paperId(step.paper), note: step.note })))
      .execute();
  }

  for (const [username, reading] of Object.entries(data.devReading)) {
    const id = userId(username);
    if (reading.interests.length) {
      await trx.insertInto('user_fields').values(reading.interests.map((field) => ({ user_id: id, field_id: ids.fieldId(field) }))).execute();
    }
    // Saved in the listed order, a minute apart, so "Up next" is the first one not read yet.
    for (const [index, paper] of reading.saves.entries()) {
      await trx
        .insertInto('paper_saves')
        .values({ user_id: id, paper_id: ids.paperId(paper), created_at: hoursAgo(48 - index / 60) })
        .execute();
    }
    for (const pass of reading.reading) {
      const at = hoursAgo(24);
      await trx
        .insertInto('reading_passes')
        .values({
          user_id: id,
          paper_id: ids.paperId(pass.paper),
          step: pass.step,
          note: pass.note ?? null,
          explored_at: at,
          studied_at: pass.step >= 2 ? at : null,
          reproduced_at: pass.step >= 3 ? at : null,
        })
        .execute();
    }
    if (reading.known.length) {
      await trx.insertInto('user_known_topics').values(reading.known.map((topic) => ({ user_id: id, topic_id: ids.topicId(topic) }))).execute();
    }
    if (reading.completed.length) {
      await trx
        .insertInto('learn_item_completions')
        .values(reading.completed.map((title) => ({ user_id: id, learn_item_id: ids.itemId(title) })))
        .execute();
    }
    if (reading.course) {
      const course = await trx.selectFrom('courses').select('id').where('title', '=', reading.course.title).executeTakeFirstOrThrow();
      await trx.insertInto('course_progress').values({ user_id: id, course_id: course.id, last_position: reading.course.position }).execute();
    }
  }

  await trx
    .insertInto('notifications')
    .values(
      data.devNotifications.map((n) => ({
        user_id: userId(n.to),
        actor_id: userId(n.actor),
        type: n.type,
        post_id: n.post ? postId(n.post) : null,
        comment_id: n.type === 'comment' && n.post ? (commentId.get(`${n.post}:${n.actor}`) ?? null) : null,
        is_read: n.read,
        created_at: hoursAgo(n.hoursAgo),
      })),
    )
    .execute();

  console.log(
    `Seeded dev activity: ${data.devPosts.length} posts, ${data.devTrails.length} trails, follows, likes, comments, ` +
      'a paper discussion, saves, reading passes and notifications.',
  );
}

/** Ordinary accounts for testing social flows (follow, like, comment) between users. Never in production. */
const DEV_USERS = ['learner1', 'learner2'];
const DEV_USER_PASSWORD = 'devpassword';

async function seedDevUsers() {
  if (isProduction) return;
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
    return;
  }
  await db.transaction().execute(async (trx) => {
    const ids = await seedContent(trx, adminId);
    if (!isProduction) await seedDevActivity(trx, ids, adminId);
  });
}

try {
  await main();
} finally {
  await db.destroy();
}
