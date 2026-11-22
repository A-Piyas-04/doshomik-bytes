import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../db';
import { audit } from '../../lib/audit';
import { badRequest, found } from '../../lib/errors';
import { fetchPage } from '../../lib/pagination';
import { httpUrl, idParams, optionalText, publicId, slug, slugify, slugParams, text, updateOf } from '../../lib/validation';
import { adminListQuery, contentId, idsInOrder, lifecycleRoutes, slugToId, syncSearch } from './content';

const FieldBody = z.object({
  name: text(100),
  slug: slug.optional(), // defaults to one made from the name
  description: optionalText(1000),
});

const Figure = z.object({
  url: httpUrl, // an upload with purpose "paper_figure", only when the paper's licence allows reuse
  caption: z.string().trim().max(500).optional(),
});

const PaperFields = z.object({
  field: slug,
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

const uniqueSlugs = z.array(slug).max(30).refine((slugs) => new Set(slugs).size === slugs.length, 'Each topic can appear once');

const RoadmapBody = z.object({
  steps: z
    .array(z.object({ paper_id: publicId, note: optionalText(500) }))
    .max(100)
    .refine((steps) => new Set(steps.map((step) => step.paper_id)).size === steps.length, 'Each paper can appear once'),
});

/** Staff view of papers: every status, with who changed them last. */
const selectPapers = () =>
  db
    .selectFrom('papers as p')
    .innerJoin('fields as f', 'f.id', 'p.field_id')
    .leftJoin('users as editor', 'editor.id', 'p.updated_by')
    .select([
      'p.public_id as id',
      'p.status',
      'f.slug as field',
      'p.title',
      'p.authors',
      'p.year',
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
      'p.created_at',
      'p.updated_at',
      'editor.username as updated_by',
    ]);

export const adminResearchRoutes: FastifyPluginAsyncZod = async (app) => {
  // ----- Fields (always live) -----
  app.post('/fields', { schema: { body: FieldBody } }, async (request, reply) => {
    const fieldSlug = request.body.slug ?? slugify(request.body.name);
    if (!fieldSlug) throw badRequest('This name has no letters a–z: give the field a slug', 'SLUG_REQUIRED');
    const field = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('fields')
        .values({ name: request.body.name, slug: fieldSlug, description: request.body.description })
        .returning(['id', 'slug', 'name', 'description'])
        .executeTakeFirstOrThrow();
      await audit(trx, request, { action: 'field.create', entityType: 'field', entityId: row.id, changes: request.body });
      return row;
    });
    const { id: _, ...publicField } = field;
    return reply.status(201).send(publicField);
  });

  app.patch('/fields/:slug', { schema: { params: slugParams, body: updateOf(FieldBody) } }, async (request) =>
    db.transaction().execute(async (trx) => {
      const row = found(
        await trx.updateTable('fields').set(request.body).where('slug', '=', request.params.slug).returning(['id', 'slug', 'name', 'description']).executeTakeFirst(),
        'Field',
      );
      await audit(trx, request, { action: 'field.update', entityType: 'field', entityId: row.id, changes: request.body });
      const { id: _, ...publicField } = row;
      return publicField;
    }),
  );

  app.delete('/fields/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const row = found(await trx.deleteFrom('fields').where('slug', '=', request.params.slug).returning('id').executeTakeFirst(), 'Field');
      await audit(trx, request, { action: 'field.delete', entityType: 'field', entityId: row.id });
    });
    return reply.status(204).send();
  });

  /** Replaces the field's starting roadmap with `steps`, in reading order. Papers may come from other fields. */
  app.put('/fields/:slug/roadmap', { schema: { params: slugParams, body: RoadmapBody } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const fieldId = await slugToId(trx, 'fields', request.params.slug);
      const paperIds = await idsInOrder(trx, 'papers', request.body.steps.map((step) => step.paper_id));
      await trx.deleteFrom('roadmap_steps').where('field_id', '=', fieldId).execute();
      if (paperIds.length) {
        await trx
          .insertInto('roadmap_steps')
          .values(
            paperIds.map((paperId, index) => ({
              field_id: fieldId,
              position: index + 1,
              paper_id: paperId,
              note: request.body.steps[index]!.note ?? null,
            })),
          )
          .execute();
      }
      await audit(trx, request, { action: 'field.roadmap', entityType: 'field', entityId: fieldId, changes: request.body });
    });
    return reply.status(204).send();
  });

  // ----- Papers (drafts until published) -----
  app.get('/papers', { schema: { querystring: adminListQuery } }, async (request) => {
    const { status, ...page } = request.query;
    return fetchPage(selectPapers().$if(status !== undefined, (qb) => qb.where('p.status', '=', status!)), 'p', page);
  });

  /** A paper in any status, with its Learn first topics: the team's preview before publishing. */
  app.get('/papers/:id', { schema: { params: idParams } }, async (request) => {
    const paper = found(await selectPapers().where('p.public_id', '=', request.params.id).executeTakeFirst(), 'Paper');
    const prerequisites = await db
      .selectFrom('paper_prerequisites as pp')
      .innerJoin('papers as p', 'p.id', 'pp.paper_id')
      .innerJoin('topics as t', 't.id', 'pp.topic_id')
      .select(['t.slug', 't.name'])
      .where('p.public_id', '=', request.params.id)
      .orderBy('pp.position')
      .execute();
    return { ...paper, prerequisites };
  });

  app.post('/papers', { schema: { body: PaperFields } }, async (request, reply) => {
    const paperPublicId = await db.transaction().execute(async (trx) => {
      const { field, figures, ...fields } = request.body;
      const row = await trx
        .insertInto('papers')
        .values({
          ...fields,
          field_id: await slugToId(trx, 'fields', field),
          figures: figures === undefined ? undefined : JSON.stringify(figures), // jsonb: send JSON text
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await syncSearch(trx, 'papers', row.id);
      await audit(trx, request, { action: 'paper.create', entityType: 'paper', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectPapers().where('p.public_id', '=', paperPublicId).executeTakeFirstOrThrow());
  });

  app.patch('/papers/:id', { schema: { params: idParams, body: updateOf(PaperFields) } }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'papers', request.params.id);
      const { field, figures, ...fields } = request.body;
      await trx
        .updateTable('papers')
        .set({
          ...fields,
          field_id: await slugToId(trx, 'fields', field),
          figures: figures === undefined ? undefined : JSON.stringify(figures),
          updated_by: request.auth.userId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await syncSearch(trx, 'papers', id);
      await audit(trx, request, { action: 'paper.update', entityType: 'paper', entityId: id, changes: request.body });
    });
    return selectPapers().where('p.public_id', '=', request.params.id).executeTakeFirstOrThrow();
  });

  /** Replaces the paper's Learn first topics with `topics` (slugs), in that order. */
  app.put(
    '/papers/:id/prerequisites',
    { schema: { params: idParams, body: z.object({ topics: uniqueSlugs }) } },
    async (request, reply) => {
      await db.transaction().execute(async (trx) => {
        const paperId = await contentId(trx, 'papers', request.params.id);
        const topicIds: number[] = [];
        for (const topic of request.body.topics) topicIds.push(await slugToId(trx, 'topics', topic));

        await trx.deleteFrom('paper_prerequisites').where('paper_id', '=', paperId).execute();
        if (topicIds.length) {
          await trx
            .insertInto('paper_prerequisites')
            .values(topicIds.map((topicId, index) => ({ paper_id: paperId, topic_id: topicId, position: index + 1 })))
            .execute();
        }
        await trx.updateTable('papers').set({ updated_by: request.auth.userId, updated_at: sql`now()` }).where('id', '=', paperId).execute();
        await audit(trx, request, { action: 'paper.prerequisites', entityType: 'paper', entityId: paperId, changes: request.body });
      });
      return reply.status(204).send();
    },
  );

  await app.register(lifecycleRoutes('/papers', 'papers'));
};
