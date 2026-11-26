import { sql } from 'kysely';
import { env } from '../../config/env';
import { db } from '../../db';
import { isPublished } from '../../db/visibility';
import { found } from '../../lib/errors';
import { fetchPage, type PageQuery } from '../../lib/pagination';
import { inArea, topicRef } from '../learn/learn.service';

/** Published questions as the app shows them: never with the answer or explanation. */
function selectQuestions() {
  return db
    .selectFrom('questions as q')
    .leftJoin('topics as t', 't.id', 'q.topic_id')
    .where(isPublished('q'))
    .select(['q.public_id as id', topicRef('t').as('topic'), 'q.kind', 'q.prompt', 'q.options']);
}

/** Random questions from one topic or one learn area, or from all for "Random". */
export function listQuestions(filter: { topic?: string; field?: string }, limit: number) {
  return selectQuestions()
    .$if(filter.topic !== undefined, (qb) => qb.where('t.slug', '=', filter.topic!))
    .$if(filter.field !== undefined, (qb) => qb.where(inArea('t', filter.field!)))
    .orderBy(sql`random()`) // fine at this volume
    .limit(limit)
    .execute();
}

/** Checks an answer and records the attempt for the user's practice history. */
export async function checkAnswer(userId: number, questionPublicId: string, answer: string) {
  const question = found(
    await db
      .selectFrom('questions as q')
      .select(['q.id', 'q.answer', 'q.explanation'])
      .where('q.public_id', '=', questionPublicId)
      .where(isPublished('q'))
      .executeTakeFirst(),
    'Question',
  );
  const correct = normalize(answer) === normalize(question.answer);
  await db.insertInto('question_attempts').values({ user_id: userId, question_id: question.id, answer, is_correct: correct }).execute();
  return { correct, correct_answer: question.answer, explanation: question.explanation };
}

/** Short answers match regardless of case and extra spaces. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function listHistory(userId: number, page: PageQuery) {
  const query = db
    .selectFrom('question_attempts as qa')
    .innerJoin('questions as q', 'q.id', 'qa.question_id')
    .leftJoin('topics as t', 't.id', 'q.topic_id')
    .where('qa.user_id', '=', userId)
    .select(['q.public_id as question_id', 'q.prompt', topicRef('t').as('topic'), 'qa.answer', 'qa.is_correct', 'qa.created_at']);
  return fetchPage(query, 'qa', page);
}

/** Accuracy per topic and overall, and the streak of consecutive days with practice. */
export async function getStats(userId: number) {
  const topics = await db
    .selectFrom('question_attempts as qa')
    .innerJoin('questions as q', 'q.id', 'qa.question_id')
    .innerJoin('topics as t', 't.id', 'q.topic_id')
    .where('qa.user_id', '=', userId)
    .groupBy(['t.slug', 't.name'])
    .select([
      't.slug',
      't.name',
      sql<number>`count(*)::int`.as('attempts'),
      sql<number>`count(*) FILTER (WHERE qa.is_correct)::int`.as('correct'),
    ])
    .orderBy('t.name')
    .execute();

  const attempts = topics.reduce((sum, t) => sum + t.attempts, 0);
  const correct = topics.reduce((sum, t) => sum + t.correct, 0);
  return {
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : null,
    streak_days: await streakDays(userId),
    topics: topics.map((t) => ({ ...t, accuracy: t.correct / t.attempts })),
  };
}

/** Consecutive local days (APP_TIMEZONE) with at least one answer, ending today or yesterday. */
async function streakDays(userId: number): Promise<number> {
  const rows = await db
    .selectFrom('question_attempts')
    .where('user_id', '=', userId)
    .select(sql<string>`to_char((created_at AT TIME ZONE ${env.APP_TIMEZONE})::date, 'YYYY-MM-DD')`.as('day'))
    .distinct()
    .orderBy('day', 'desc')
    .limit(366)
    .execute();

  const today = localDay(new Date());
  let expected = rows[0]?.day === today ? today : shiftDay(today, -1);
  let streak = 0;
  for (const { day } of rows) {
    if (day !== expected) break;
    streak++;
    expected = shiftDay(expected, -1);
  }
  return streak;
}

const localDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: env.APP_TIMEZONE }); // YYYY-MM-DD
const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ---------- Quizzes: named question sets in a fixed order ----------

function selectQuizzes() {
  return db
    .selectFrom('quizzes as qz')
    .leftJoin('topics as t', 't.id', 'qz.topic_id')
    .where(isPublished('qz'))
    .select((eb) => [
      'qz.public_id as id',
      'qz.title',
      topicRef('t').as('topic'),
      'qz.created_at',
      eb
        .selectFrom('quiz_questions as qq')
        .innerJoin('questions as q', 'q.id', 'qq.question_id')
        .whereRef('qq.quiz_id', '=', 'qz.id')
        .where(isPublished('q'))
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .as('question_count'),
    ]);
}

export function listQuizzes(filter: { topic?: string; field?: string }, page: PageQuery) {
  const query = selectQuizzes()
    .$if(filter.topic !== undefined, (qb) => qb.where('t.slug', '=', filter.topic!))
    .$if(filter.field !== undefined, (qb) => qb.where(inArea('t', filter.field!)));
  return fetchPage(query, 'qz', page);
}

export async function getQuiz(quizPublicId: string) {
  const quiz = found(await selectQuizzes().where('qz.public_id', '=', quizPublicId).executeTakeFirst(), 'Quiz');
  const questions = await selectQuestions()
    .innerJoin('quiz_questions as qq', 'qq.question_id', 'q.id')
    .innerJoin('quizzes as qz', 'qz.id', 'qq.quiz_id')
    .where('qz.public_id', '=', quizPublicId)
    .orderBy('qq.position')
    .execute();
  return { ...quiz, questions };
}
