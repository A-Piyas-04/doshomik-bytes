import { sql } from 'kysely';
import { db } from '../../db';
import { found } from '../../lib/errors';

/** Random questions, from one topic or from all. Answers stay on the server until the user submits. */
export function listQuestions(filter: { topicId?: number }, limit: number) {
  return db
    .selectFrom('questions')
    .select(['id', 'topic_id', 'kind', 'prompt', 'options'])
    .$if(filter.topicId !== undefined, (qb) => qb.where('topic_id', '=', filter.topicId!))
    .orderBy(sql`random()`) // fine at v1 volume
    .limit(limit)
    .execute();
}

/** Nothing is saved: v1 keeps no practice history. */
export async function checkAnswer(questionId: number, answer: string) {
  const question = found(
    await db.selectFrom('questions').select(['answer', 'explanation']).where('id', '=', questionId).executeTakeFirst(),
    'Question',
  );
  return {
    correct: normalize(answer) === normalize(question.answer),
    correct_answer: question.answer,
    explanation: question.explanation,
  };
}

/** Short answers match regardless of case and extra spaces. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
