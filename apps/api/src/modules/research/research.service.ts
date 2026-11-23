import {
  PAPER_NEW_DAYS,
  PAPER_STATUSES,
  PAPER_TRENDING_DAYS,
  type PaperStatus,
  type PrerequisiteLinkKind,
  type ReadingStep,
} from '@doshomik/shared';
import { sql } from 'kysely';
import { env } from '../../config/env';
import { db } from '../../db';
import { fullText } from '../../db/search';
import { canSeeContentOf, isPublished, isVisiblePost } from '../../db/visibility';
import { found, notFound } from '../../lib/errors';
import { fetchPage, fetchRankedPage, type PageQuery } from '../../lib/pagination';
import { MEDIA_COLUMNS, mediaView } from '../media/media.service';
import { visibleUserId } from '../users/users.service';

/** The default Research order. Must match papers_trend_idx: unranked papers come last. */
const trendRank = sql<number>`coalesce(p.trend_rank, 2147483647)`;

/**
 * Published papers as lists show them: metadata from ingestion (venue, citations, Hugging Face
 * upvotes, trend rank, New badge), the card question in both languages, and the viewer's save,
 * reading step and Prototype 2 tracker status (`my_status`, kept as it was).
 */
export function selectPaperCards(viewerId: number) {
  return db
    .selectFrom('papers as p')
    .innerJoin('fields as f', 'f.id', 'p.field_id')
    .where(isPublished('p'))
    .select((eb) => [
      'p.public_id as id',
      'p.title',
      'p.authors',
      'p.year',
      'p.venue',
      'p.created_at',
      sql<{ slug: string; name: string }>`json_build_object('slug', f.slug, 'name', f.name)`.as('field'),
      sql<string>`${env.PUBLIC_URL} || '/papers/' || p.public_id`.as('share_url'),
      sql<{ en: string | null; bn: string | null }>`json_build_object(
        'en', (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'en'),
        'bn', (SELECT c.question FROM paper_cards c WHERE c.paper_id = p.id AND c.lang = 'bn'))`.as('question'),
      'p.tldr',
      'p.citation_count',
      'p.hf_upvotes',
      'p.trend_rank',
      sql<boolean>`coalesce(p.hf_trending_at >= now() - make_interval(days => ${PAPER_TRENDING_DAYS}), false)`.as('is_trending'),
      sql<boolean>`coalesce(p.published_on >= current_date - ${PAPER_NEW_DAYS}::int, false)`.as('is_new'),
      eb
        .exists(eb.selectFrom('paper_saves as s').whereRef('s.paper_id', '=', 'p.id').where('s.user_id', '=', viewerId).select(sql.lit(1).as('one')))
        .$castTo<boolean>()
        .as('saved_by_me'),
      sql<ReadingStep>`coalesce((SELECT rp.step FROM reading_passes rp WHERE rp.user_id = ${viewerId} AND rp.paper_id = p.id), 0)`.as('my_step'),
      eb
        .selectFrom('user_papers as mine')
        .whereRef('mine.paper_id', '=', 'p.id')
        .where('mine.user_id', '=', viewerId)
        .select('mine.status')
        .as('my_status'),
    ]);
}

/** The topic chips, in their fixed order (ML fundamentals → … → Emerging research). */
export function listFields() {
  return db.selectFrom('fields').select(['slug', 'name', 'description', 'position']).orderBy('position').orderBy('name').execute();
}

export type PaperSort = 'trend' | 'newest';

/**
 * The collection. Default order is the trend rank the worker keeps (A1). `q` searches title,
 * authors and the card question in English and Bangla (A2). `interests: true` keeps the
 * viewer's onboarding fields.
 */
export function listPapers(
  viewerId: number,
  filter: { field?: string; q?: string; interests?: boolean; sort?: PaperSort },
  page: PageQuery,
) {
  const query = selectPaperCards(viewerId)
    .$if(filter.field !== undefined, (qb) => qb.where('f.slug', '=', filter.field!))
    .$if(filter.q !== undefined, (qb) => qb.where(fullText.paper('p', filter.q!)))
    .$if(filter.interests === true, (qb) =>
      qb.where('p.field_id', 'in', (eb) => eb.selectFrom('user_fields').select('field_id').where('user_id', '=', viewerId)),
    );
  if (filter.sort === 'newest') return fetchPage(query, 'p', page);
  return fetchRankedPage(query, { rank: trendRank, id: 'p.id' }, page);
}

type CardJson = Record<'en' | 'bn', unknown>;

/**
 * The paper screen: the Prototype 2 structured summary (unchanged), the Paper Card in each language
 * it exists in, scholarly metadata, the links to open the original (A10; we never host a PDF) and
 * the viewer's own reading pass with their private note.
 */
export async function getPaper(viewerId: number, paperPublicId: string) {
  const paper = await selectPaperCards(viewerId)
    .select([
      'p.paper_url',
      'p.research_questions',
      'p.main_idea',
      'p.data_source',
      'p.method_steps',
      'p.results',
      'p.figures',
      'p.limitations',
      'p.evaluation',
      'p.published_at',
      'p.abstract',
      'p.doi',
      'p.arxiv_id',
      sql<string | null>`to_char(p.published_on, 'YYYY-MM-DD')`.as('published_on'),
      sql<{ open_url: string; pdf_url: string | null; code_url: string | null }>`json_build_object(
        'open_url', p.paper_url, 'pdf_url', p.pdf_url, 'code_url', p.code_url)`.as('links'),
      sql<Partial<CardJson>>`coalesce((
        SELECT json_object_agg(c.lang, json_build_object(
          'question', c.question, 'problem', c.problem, 'key_idea', c.key_idea, 'method_steps', c.method_steps,
          'findings', c.findings, 'takeaway', c.takeaway, 'limitations', c.limitations, 'glossary', c.glossary,
          'source', c.source, 'updated_at', c.updated_at))
        FROM paper_cards c WHERE c.paper_id = p.id), '{}'::json)`.as('cards'),
      sql<unknown>`(SELECT json_build_object('step', rp.step, 'note', rp.note, 'explored_at', rp.explored_at,
          'studied_at', rp.studied_at, 'reproduced_at', rp.reproduced_at, 'updated_at', rp.updated_at)
        FROM reading_passes rp WHERE rp.user_id = ${viewerId} AND rp.paper_id = p.id)`.as('my_reading'),
    ])
    .where('p.public_id', '=', paperPublicId)
    .executeTakeFirst();
  return found(paper, 'Paper');
}

// ---------- A13: Learn before reading ----------

type LinkView = { kind: PrerequisiteLinkKind; id: string; title: string | null; minutes?: number | null; question_count?: number; seconds?: number | null };

const minutesOf = (seconds: number | null) => (seconds === null ? null : Math.max(1, Math.ceil(seconds / 60)));

/**
 * Learn first: the paper's prerequisite concepts in order. Each has a label, why it matters, and a
 * typed link to our own lesson, note, quiz or reel. `done` is computed: the linked lesson or note
 * is completed, every question of the linked quiz has been answered, or the user said "I already
 * know this". The Prototype 2 shape (each topic with all its learn items) is kept alongside.
 */
export async function getLearnFirst(viewerId: number, paperPublicId: string) {
  const paperId = await publishedPaperId(paperPublicId);

  const rows = await db
    .selectFrom('paper_prerequisites as pp')
    .innerJoin('topics as t', 't.id', 'pp.topic_id')
    .leftJoin('learn_items as li', (join) => join.onRef('li.id', '=', 'pp.learn_item_id').on('li.status', '=', 'published'))
    .leftJoin('media_assets as lim', 'lim.id', 'li.media_id')
    .leftJoin('quizzes as qz', (join) => join.onRef('qz.id', '=', 'pp.quiz_id').on('qz.status', '=', 'published'))
    .leftJoin('posts as reel', 'reel.id', 'pp.reel_post_id')
    .leftJoin('users as ru', 'ru.id', 'reel.user_id')
    .leftJoin('media_assets as rm', 'rm.id', 'reel.media_id')
    .where('pp.paper_id', '=', paperId)
    .select([
      't.id as topic_id',
      't.slug',
      't.name',
      't.summary',
      'pp.label',
      'pp.why',
      'pp.suggested_by',
      'li.public_id as lesson_id',
      'li.title as lesson_title',
      'li.kind as lesson_kind',
      sql<number | null>`coalesce(lim.duration_ms / 1000, li.duration_seconds)`.as('lesson_seconds'),
      sql<number | null>`CASE WHEN li.id IS NULL THEN NULL
        ELSE coalesce(array_length(regexp_split_to_array(btrim(coalesce(li.body, '')), '\\s+'), 1), 0) END`.as('lesson_words'),
      'qz.public_id as quiz_id',
      'qz.title as quiz_title',
      sql<number>`(SELECT count(*)::int FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id
        WHERE qq.quiz_id = qz.id AND q.status = 'published')`.as('quiz_questions'),
      sql<string | null>`CASE WHEN reel.type = 'reel' AND ${isVisiblePost(viewerId, 'reel', 'ru')} THEN reel.public_id END`.as('reel_id'),
      'reel.caption as reel_caption',
      sql<number | null>`rm.duration_ms / 1000`.as('reel_seconds'),
      sql<boolean>`EXISTS (SELECT 1 FROM user_known_topics k WHERE k.user_id = ${viewerId} AND k.topic_id = t.id)`.as('known'),
      sql<boolean>`(li.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM learn_item_completions c WHERE c.user_id = ${viewerId} AND c.learn_item_id = li.id))`.as('lesson_done'),
      sql<boolean>`(qz.id IS NOT NULL
        AND EXISTS (SELECT 1 FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id AND q.status = 'published'
                    WHERE qq.quiz_id = qz.id)
        AND NOT EXISTS (SELECT 1 FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id AND q.status = 'published'
                        WHERE qq.quiz_id = qz.id
                          AND NOT EXISTS (SELECT 1 FROM question_attempts qa WHERE qa.user_id = ${viewerId} AND qa.question_id = q.id)))`.as(
        'quiz_done',
      ),
    ])
    .orderBy('pp.position')
    .orderBy('t.id')
    .execute();

  // Prototype 2 shape: every published learn item of each prerequisite topic.
  const topicIds = rows.map((row) => row.topic_id);
  const items = topicIds.length
    ? await db
        .selectFrom('learn_items as li')
        .leftJoin('media_assets as m', 'm.id', 'li.media_id')
        .select(['li.topic_id', 'li.public_id as item_id', 'li.title', 'li.kind', 'li.media_url', ...MEDIA_COLUMNS])
        .where('li.topic_id', 'in', topicIds)
        .where(isPublished('li'))
        .orderBy('li.id')
        .execute()
    : [];

  const topics = rows.map((row) => {
    let link: LinkView | null = null;
    if (row.lesson_id) {
      const isLesson = row.lesson_kind === 'video';
      link = {
        kind: isLesson ? 'lesson' : 'note',
        id: row.lesson_id,
        title: row.lesson_title,
        minutes: isLesson ? minutesOf(row.lesson_seconds) : Math.max(1, Math.ceil((row.lesson_words ?? 0) / 200)),
      };
    } else if (row.quiz_id) {
      link = { kind: 'quiz', id: row.quiz_id, title: row.quiz_title, question_count: row.quiz_questions };
    } else if (row.reel_id) {
      link = { kind: 'reel', id: row.reel_id, title: row.reel_caption, seconds: row.reel_seconds };
    }
    return {
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      label: row.label ?? row.name,
      why: row.why,
      suggested_by: row.suggested_by,
      link,
      known: row.known,
      done: row.known || row.lesson_done || row.quiz_done,
      learn_items: items
        .filter((item) => item.topic_id === row.topic_id)
        .map((item) => ({ id: item.item_id, title: item.title, kind: item.kind, media: mediaView(item, { private: false }), media_url: item.media_url })),
    };
  });

  return {
    total: topics.length,
    ready: topics.filter((topic) => topic.done).length,
    /** True when the list was suggested by AI when the card was prepared; the app shows a footnote. */
    ai_suggested: topics.some((topic) => topic.suggested_by === 'ai'),
    topic_count: topics.length,
    topics_with_learn_items: topics.filter((topic) => topic.learn_items.length > 0).length,
    topics,
  };
}

/**
 * "Papers like this one": published papers ranked by how many Learn first topics they share,
 * then same field, then newest. Semantic similarity replaces this when Elasticsearch arrives.
 */
export async function getRelatedPapers(viewerId: number, paperPublicId: string, limit: number) {
  const paper = found(
    await db.selectFrom('papers as p').select(['p.id', 'p.field_id']).where('p.public_id', '=', paperPublicId).where(isPublished('p')).executeTakeFirst(),
    'Paper',
  );
  const sharedTopics = sql<number>`(
    SELECT count(*)::int FROM paper_prerequisites a
    JOIN paper_prerequisites b ON b.topic_id = a.topic_id
    WHERE a.paper_id = ${paper.id} AND b.paper_id = p.id
  )`;
  return selectPaperCards(viewerId)
    .select(sharedTopics.as('shared_topics'))
    .where('p.id', '!=', paper.id)
    .where((eb) => eb.or([eb(sharedTopics, '>', 0), eb('p.field_id', '=', paper.field_id)]))
    .orderBy(sharedTopics, 'desc')
    .orderBy(sql`p.field_id = ${paper.field_id}`, 'desc')
    .orderBy('p.created_at', 'desc')
    .limit(limit)
    .execute();
}

/**
 * A6, lineage: the published papers this one builds on (it cites them) and the notable ones that
 * built on it (they cite it), influential citations first, then most cited. Each carries the
 * citation intent; `contrasting` ("this later paper disputes this result") is set by staff.
 */
export async function getLineage(viewerId: number, paperPublicId: string, limit: number) {
  const paperId = await publishedPaperId(paperPublicId);
  const [buildsOn, builtOnBy] = await Promise.all([
    selectPaperCards(viewerId)
      .innerJoin('paper_edges as e', 'e.cited_paper_id', 'p.id')
      .where('e.citing_paper_id', '=', paperId)
      .select(['e.intent', 'e.is_influential'])
      .orderBy('e.is_influential', 'desc')
      .orderBy(sql`p.citation_count DESC NULLS LAST`)
      .orderBy('p.id')
      .limit(limit)
      .execute(),
    selectPaperCards(viewerId)
      .innerJoin('paper_edges as e', 'e.citing_paper_id', 'p.id')
      .where('e.cited_paper_id', '=', paperId)
      .select(['e.intent', 'e.is_influential'])
      .orderBy('e.is_influential', 'desc')
      .orderBy(sql`p.citation_count DESC NULLS LAST`)
      .orderBy('p.id')
      .limit(limit)
      .execute(),
  ]);
  return { builds_on: buildsOn, built_on_by: builtOnBy };
}

// ---------- A3 / A4 / A5: saves, reading passes, My papers ----------

export async function savePaper(userId: number, paperPublicId: string): Promise<void> {
  const paperId = await publishedPaperId(paperPublicId);
  await db.insertInto('paper_saves').values({ user_id: userId, paper_id: paperId }).onConflict((oc) => oc.doNothing()).execute();
}

export async function unsavePaper(userId: number, paperPublicId: string): Promise<void> {
  await db
    .deleteFrom('paper_saves')
    .where('user_id', '=', userId)
    .where('paper_id', '=', (eb) => eb.selectFrom('papers').select('id').where('public_id', '=', paperPublicId))
    .execute();
}

type ReadingRow = {
  step: ReadingStep;
  note: string | null;
  explored_at: Date | null;
  studied_at: Date | null;
  reproduced_at: Date | null;
  updated_at: Date;
};

/**
 * Sets the reading step. `exact` lets the user move to any step, including back down (later step
 * times are cleared); `at_least` only raises it, for the one-tap "Mark read" (step 1).
 */
export async function setReadingStep(userId: number, paperPublicId: string, step: ReadingStep, mode: 'exact' | 'at_least') {
  const paperId = await publishedPaperId(paperPublicId);
  const next = mode === 'at_least' ? sql`greatest(rp.step, ${step}::smallint)` : sql`${step}::smallint`;
  const { rows } = await sql<ReadingRow>`
    INSERT INTO reading_passes AS rp (user_id, paper_id, step, explored_at, studied_at, reproduced_at)
    VALUES (${userId}, ${paperId}, ${step}::smallint,
            CASE WHEN ${step}::smallint >= 1 THEN now() END,
            CASE WHEN ${step}::smallint >= 2 THEN now() END,
            CASE WHEN ${step}::smallint >= 3 THEN now() END)
    ON CONFLICT (user_id, paper_id) DO UPDATE SET
      step          = ${next},
      explored_at   = CASE WHEN ${next} >= 1 THEN coalesce(rp.explored_at, now()) END,
      studied_at    = CASE WHEN ${next} >= 2 THEN coalesce(rp.studied_at, now()) END,
      reproduced_at = CASE WHEN ${next} >= 3 THEN coalesce(rp.reproduced_at, now()) END,
      updated_at    = now()
    RETURNING step, note, explored_at, studied_at, reproduced_at, updated_at`.execute(db);
  return { paper_id: paperPublicId, ...rows[0]! };
}

/** The private note (at most 400 characters; null clears it). Only its owner ever reads it. */
export async function setPaperNote(userId: number, paperPublicId: string, note: string | null) {
  const paperId = await publishedPaperId(paperPublicId);
  const row = await db
    .insertInto('reading_passes')
    .values({ user_id: userId, paper_id: paperId, note })
    .onConflict((oc) => oc.columns(['user_id', 'paper_id']).doUpdateSet({ note, updated_at: sql`now()` }))
    .returning(['step', 'note', 'explored_at', 'studied_at', 'reproduced_at', 'updated_at'])
    .executeTakeFirstOrThrow();
  return { paper_id: paperPublicId, ...row };
}

/** Saved papers not yet read (no step 1). */
function savedUnread(userId: number) {
  return selectPaperCards(userId)
    .innerJoin('paper_saves as s', 's.paper_id', 'p.id')
    .where('s.user_id', '=', userId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('reading_passes as rp')
            .whereRef('rp.paper_id', '=', 'p.id')
            .where('rp.user_id', '=', userId)
            .where('rp.step', '>=', 1)
            .select(sql.lit(1).as('one')),
        ),
      ),
    )
    .select('s.created_at as saved_at');
}

/** "Up next" on the Research home: the earliest saved paper the user hasn't marked read. */
export async function getUpNext(userId: number) {
  const paper = await savedUnread(userId).orderBy('s.created_at').orderBy('p.id').limit(1).executeTakeFirst();
  return { paper: paper ?? null };
}

/** My papers: `saved` (saved, not read yet, newest saved first) or `read` (step ≥ 1, latest first). */
export function listMyPapers(userId: number, list: 'saved' | 'read', page: PageQuery) {
  if (list === 'saved') return fetchPage(savedUnread(userId), { createdAt: 's.created_at', id: 'p.id' }, page);
  const read = selectPaperCards(userId)
    .innerJoin('reading_passes as rp', 'rp.paper_id', 'p.id')
    .where('rp.user_id', '=', userId)
    .where('rp.step', '>=', 1)
    .select('rp.updated_at as read_at');
  return fetchPage(read, { createdAt: 'rp.updated_at', id: 'p.id' }, page);
}

/** How many papers reached each step, this month (APP_TIMEZONE) and in total. Steps are cumulative. */
async function readingCounts(userId: number) {
  const monthStart = sql`(date_trunc('month', now() AT TIME ZONE ${env.APP_TIMEZONE}) AT TIME ZONE ${env.APP_TIMEZONE})`;
  const row = await db
    .selectFrom('reading_passes')
    .where('user_id', '=', userId)
    .select([
      sql<number>`count(*) FILTER (WHERE explored_at >= ${monthStart})::int`.as('month_explored'),
      sql<number>`count(*) FILTER (WHERE studied_at >= ${monthStart})::int`.as('month_studied'),
      sql<number>`count(*) FILTER (WHERE reproduced_at >= ${monthStart})::int`.as('month_reproduced'),
      sql<number>`count(*) FILTER (WHERE step >= 1)::int`.as('explored'),
      sql<number>`count(*) FILTER (WHERE step >= 2)::int`.as('studied'),
      sql<number>`count(*) FILTER (WHERE step >= 3)::int`.as('reproduced'),
    ])
    .executeTakeFirstOrThrow();
  return {
    this_month: { explored: row.month_explored, studied: row.month_studied, reproduced: row.month_reproduced },
    total: { explored: row.explored, studied: row.studied, reproduced: row.reproduced },
  };
}

export const getMyReadingStats = (userId: number) => readingCounts(userId);

/** Profile → Reading. Like posts and the tracker, a private account's counts are for accepted followers only. */
export async function getUserReadingStats(viewerId: number, userPublicId: string) {
  const ownerId = await visibleUserId(viewerId, userPublicId);
  const visible = await db
    .selectFrom('users as owner')
    .select('owner.id')
    .where('owner.id', '=', ownerId)
    .where(canSeeContentOf(viewerId, 'owner'))
    .executeTakeFirst();
  if (!visible) return { visible: false, this_month: null, total: null };
  return { visible: true, ...(await readingCounts(ownerId)) };
}

/** My papers → Maps and roadmaps: saved AI outputs, newest first, without their (large) result. */
export function listResearchOutputs(userId: number, page: PageQuery) {
  const query = db
    .selectFrom('research_outputs as o')
    .where('o.user_id', '=', userId)
    .select(['o.public_id as id', 'o.kind', 'o.title', 'o.params', 'o.created_at']);
  return fetchPage(query, 'o', page);
}

/** Reopens a saved output from the stored row: no AI call, nothing counted against an allowance. */
export async function getResearchOutput(userId: number, outputPublicId: string) {
  const output = await db
    .selectFrom('research_outputs')
    .select(['public_id as id', 'kind', 'title', 'params', 'result', 'created_at'])
    .where('public_id', '=', outputPublicId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return found(output, 'Output');
}

export async function deleteResearchOutput(userId: number, outputPublicId: string): Promise<void> {
  const result = await db.deleteFrom('research_outputs').where('public_id', '=', outputPublicId).where('user_id', '=', userId).executeTakeFirst();
  if (result.numDeletedRows === 0n) throw notFound('Output');
}

// ---------- Prototype 2 tracker (kept as it was) ----------

/** Save (status "saved"), or move along the tracker to "reading" and "completed". */
export async function setPaperStatus(userId: number, paperPublicId: string, status: PaperStatus) {
  const paperId = await publishedPaperId(paperPublicId);
  const row = await db
    .insertInto('user_papers')
    .values({ user_id: userId, paper_id: paperId, status })
    .onConflict((oc) => oc.columns(['user_id', 'paper_id']).doUpdateSet({ status, updated_at: sql`now()` }))
    .returning(['status', 'updated_at'])
    .executeTakeFirstOrThrow();
  return { paper_id: paperPublicId, ...row };
}

export async function removePaperStatus(userId: number, paperPublicId: string): Promise<void> {
  await db
    .deleteFrom('user_papers')
    .where('user_id', '=', userId)
    .where('paper_id', '=', (eb) => eb.selectFrom('papers').select('id').where('public_id', '=', paperPublicId))
    .execute();
}

/**
 * A user's tracker for their profile, grouped by status. Like their posts, a private account's
 * tracker is empty to anyone but accepted followers.
 */
export async function getReadingTracker(viewerId: number, userPublicId: string) {
  const ownerId = await visibleUserId(viewerId, userPublicId);
  const rows = await selectPaperCards(viewerId)
    .innerJoin('user_papers as tracked', 'tracked.paper_id', 'p.id')
    .innerJoin('users as owner', 'owner.id', 'tracked.user_id')
    .where('tracked.user_id', '=', ownerId)
    .where(canSeeContentOf(viewerId, 'owner'))
    .select(['tracked.status', 'tracked.updated_at'])
    .orderBy('tracked.updated_at', 'desc')
    .execute();
  return Object.fromEntries(PAPER_STATUSES.map((status) => [status, rows.filter((row) => row.status === status)])) as Record<
    PaperStatus,
    typeof rows
  >;
}

/** A field's starting roadmap: published papers in reading order, numbered 1..n, each with a note. */
export async function getRoadmap(viewerId: number, fieldSlug: string) {
  const field = found(
    await db.selectFrom('fields').select(['id', 'slug', 'name', 'description']).where('slug', '=', fieldSlug).executeTakeFirst(),
    'Field',
  );
  const rows = await selectPaperCards(viewerId)
    .innerJoin('roadmap_steps as rs', 'rs.paper_id', 'p.id')
    .where('rs.field_id', '=', field.id)
    .select('rs.note')
    .orderBy('rs.position')
    .execute();
  const { id: _, ...publicField } = field;
  return { field: publicField, steps: rows.map(({ note, ...paper }, index) => ({ step: index + 1, note, paper })) };
}

export async function publishedPaperId(paperPublicId: string): Promise<number> {
  const paper = await db.selectFrom('papers as p').select('p.id').where('p.public_id', '=', paperPublicId).where(isPublished('p')).executeTakeFirst();
  return found(paper, 'Paper').id;
}
