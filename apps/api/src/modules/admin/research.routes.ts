import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db';
import { found } from '../../lib/errors';
import { httpUrl, id, idParams, optionalText, text, updateOf } from '../../lib/validation';
import { deleteById } from './delete-by-id';

const FieldBody = z.object({
  name: text(100),
  description: optionalText(1000),
});

const Figure = z.object({
  url: httpUrl, // only when the paper's licence allows reuse
  caption: z.string().trim().max(500).optional(),
});

const PaperFields = z.object({
  field_id: id,
  title: text(300),
  authors: optionalText(1000),
  year: z.number().int().min(1900).max(2100).nullish(),
  paper_url: httpUrl,
  research_questions: z.array(text(1000)).max(20).optional(),
  main_idea: optionalText(5000),
  data_source: optionalText(2000),
  method_steps: z.array(text(2000)).max(30).optional(),
  results: optionalText(5000),
  figures: z.array(Figure).max(20).optional(),
  limitations: optionalText(5000),
  evaluation: optionalText(5000),
});

// figures is a jsonb column: send it as JSON text, not as a Postgres array.
const toRow = <T extends { figures?: z.infer<typeof Figure>[] }>({ figures, ...paper }: T) => ({
  ...paper,
  figures: figures === undefined ? undefined : JSON.stringify(figures),
});

const uniqueIds = (ids: number[]) => new Set(ids).size === ids.length;

const PrerequisitesBody = z.object({
  topic_ids: z.array(id).max(30).refine(uniqueIds, 'Each topic can appear once'),
});

const RoadmapBody = z.object({
  steps: z
    .array(z.object({ paper_id: id, note: optionalText(500) }))
    .max(100)
    .refine((steps) => uniqueIds(steps.map((step) => step.paper_id)), 'Each paper can appear once'),
});

export const adminResearchRoutes: FastifyPluginAsyncZod = async (app) => {
  // Fields
  app.post('/fields', { schema: { body: FieldBody } }, async (request, reply) => {
    const field = await db.insertInto('fields').values(request.body).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(field);
  });

  app.patch('/fields/:id', { schema: { params: idParams, body: updateOf(FieldBody) } }, async (request) =>
    found(
      await db.updateTable('fields').set(request.body).where('id', '=', request.params.id).returningAll().executeTakeFirst(),
      'Field',
    ),
  );

  app.delete('/fields/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('fields', request.params.id, 'Field');
    return reply.status(204).send();
  });

  /** Replaces the field's starting roadmap with `steps`, in reading order. Papers may come from other fields. */
  app.put('/fields/:id/roadmap', { schema: { params: idParams, body: RoadmapBody } }, async (request, reply) => {
    const fieldId = request.params.id;
    found(await db.selectFrom('fields').select('id').where('id', '=', fieldId).executeTakeFirst(), 'Field');

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('roadmap_steps').where('field_id', '=', fieldId).execute();
      if (request.body.steps.length === 0) return;
      await trx
        .insertInto('roadmap_steps')
        .values(
          request.body.steps.map((step, index) => ({
            field_id: fieldId,
            position: index + 1,
            paper_id: step.paper_id,
            note: step.note ?? null,
          })),
        )
        .execute();
    });
    return reply.status(204).send();
  });

  // Papers
  app.post('/papers', { schema: { body: PaperFields } }, async (request, reply) => {
    const paper = await db.insertInto('papers').values(toRow(request.body)).returningAll().executeTakeFirstOrThrow();
    return reply.status(201).send(paper);
  });

  app.patch('/papers/:id', { schema: { params: idParams, body: updateOf(PaperFields) } }, async (request) =>
    found(
      await db
        .updateTable('papers')
        .set(toRow(request.body))
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst(),
      'Paper',
    ),
  );

  app.delete('/papers/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteById('papers', request.params.id, 'Paper');
    return reply.status(204).send();
  });

  /** Replaces the paper's Learn first topics with `topic_ids`, in that order. */
  app.put('/papers/:id/prerequisites', { schema: { params: idParams, body: PrerequisitesBody } }, async (request, reply) => {
    const paperId = request.params.id;
    found(await db.selectFrom('papers').select('id').where('id', '=', paperId).executeTakeFirst(), 'Paper');

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('paper_prerequisites').where('paper_id', '=', paperId).execute();
      if (request.body.topic_ids.length === 0) return;
      await trx
        .insertInto('paper_prerequisites')
        .values(request.body.topic_ids.map((topicId, index) => ({ paper_id: paperId, topic_id: topicId, position: index + 1 })))
        .execute();
    });
    return reply.status(204).send();
  });
};
