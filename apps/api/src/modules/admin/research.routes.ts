import { CONTENT_LANGS, PAPER_CARD_SOURCES, PAPER_EDGE_INTENTS, PREREQUISITE_SOURCES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, type Db } from '../../db';
import { refreshPaperSearch } from '../../db/search';
import { audit } from '../../lib/audit';
import { badRequest, conflict, found } from '../../lib/errors';
import { fetchPage } from '../../lib/pagination';
import { httpUrl, idParams, optionalText, publicId, slug, slugify, slugParams, text, updateOf } from '../../lib/validation';
import { createPaperCompanions, summaryFromEnglishCard } from '../research/research.service';
import { adminListQuery, contentId, idsInOrder, lifecycleRoutes, slugToId, syncSearch } from './content';

const FieldBody = z.object({
  name: text(100),
  slug: slug.optional(), // defaults to one made from the name
  description: optionalText(1000),
  position: z.number().int().min(0).max(1000).optional(), // chip order, smallest first
});

/** arXiv ids without version (1706.03762, or old style cs/0112017). */
const arxivId = z
  .string()
  .trim()
  .regex(/^(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})$/i, 'An arXiv id such as 1706.03762, without version');
/** DOIs are stored lower-cased, without the https://doi.org/ prefix. */
const doi = z
  .string()
  .trim()
  .transform((value) => value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase())
  .pipe(z.string().regex(/^10\.\d{4,9}\/\S+$/, 'A DOI such as 10.18653/v1/n19-1423'));

const Figure = z.object({
  url: httpUrl, // an upload with purpose "paper_figure", only when the paper's licence allows reuse
  caption: z.string().trim().max(500).optional(),
});

/**
 * A paper as staff edit it. The Prototype 2 summary fields (research_questions … evaluation) are
 * kept for the admin panel but stored on the English Paper Card (migration 006); doi and arxiv_id
 * go to paper_metadata.
 */
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
  // Scholarly metadata (A1, A10). The ingestion worker fills the empty ones from OpenAlex and Semantic Scholar.
  venue: optionalText(200),
  abstract: optionalText(10000),
  published_on: z.iso.date().nullish(),
  doi: doi.nullish(),
  arxiv_id: arxivId.nullish(),
  pdf_url: httpUrl.nullish(),
  code_url: httpUrl.nullish(),
});

const ImportBody = z
  .object({ field: slug, arxiv_id: arxivId.optional(), doi: doi.optional() })
  .refine((body) => Boolean(body.arxiv_id) !== Boolean(body.doi), 'Give either arxiv_id or doi');

/**
 * A full card. The four fields added by migration 006 (extra_questions, data_source, evaluation,
 * figures) hold content moved from papers, so a PUT that leaves them out keeps them as they are:
 * a client written before 006 can't wipe them. Send null or [] to clear one.
 */
const CardBody = z.object({
  question: optionalText(1000),
  extra_questions: z.array(text(1000)).max(19).optional(), // further research questions, in order
  problem: optionalText(3000),
  key_idea: optionalText(3000),
  data_source: optionalText(2000),
  method_steps: z.array(text(2000)).max(30).default([]),
  findings: optionalText(5000),
  evaluation: optionalText(5000),
  figures: z.array(Figure).max(20).optional(),
  takeaway: optionalText(2000),
  limitations: optionalText(5000),
  glossary: z.array(z.object({ term: text(100), definition: text(500) })).max(50).default([]),
  source: z.enum(PAPER_CARD_SOURCES).default('staff'),
});

const CARD_COLUMNS = [
  'lang',
  'question',
  'extra_questions',
  'problem',
  'key_idea',
  'data_source',
  'method_steps',
  'findings',
  'evaluation',
  'figures',
  'takeaway',
  'limitations',
  'glossary',
  'source',
  'updated_at',
] as const;

/** A prerequisite with its label, why it matters, and a typed link to our own content (A13). */
const PrerequisiteItem = z.object({
  topic: slug,
  label: optionalText(120),
  why: optionalText(300),
  link: z.object({ kind: z.enum(['learn_item', 'quiz', 'reel']), id: publicId }).nullish(),
  suggested_by: z.enum(PREREQUISITE_SOURCES).default('staff'),
});

const EdgeBody = z.object({
  citing_paper_id: publicId,
  cited_paper_id: publicId,
  intent: z.enum(PAPER_EDGE_INTENTS),
});

const uniqueSlugs = z.array(slug).max(30).refine((slugs) => new Set(slugs).size === slugs.length, 'Each topic can appear once');

const RoadmapBody = z.object({
  steps: z
    .array(z.object({ paper_id: publicId, note: optionalText(500) }))
    .max(100)
    .refine((steps) => new Set(steps.map((step) => step.paper_id)).size === steps.length, 'Each paper can appear once'),
});

/**
 * Staff view of papers: every status, with who changed them last. Same response shape as before
 * migration 006. Left joins on the companions, so a paper that somehow lacks them still shows here.
 */
const selectPapers = () =>
  db
    .selectFrom('papers as p')
    .innerJoin('fields as f', 'f.id', 'p.field_id')
    .leftJoin('paper_metadata as pmd', 'pmd.paper_id', 'p.id')
    .leftJoin('paper_metrics as pm', 'pm.paper_id', 'p.id')
    .leftJoin('paper_sync as ps', 'ps.paper_id', 'p.id')
    .leftJoin('paper_cards as en', (join) => join.onRef('en.paper_id', '=', 'p.id').on('en.lang', '=', 'en'))
    .leftJoin('users as editor', 'editor.id', 'p.updated_by')
    .select([
      'p.public_id as id',
      'p.status',
      'f.slug as field',
      'p.title',
      'p.authors',
      'p.year',
      'p.paper_url',
      ...summaryFromEnglishCard(),
      'p.venue',
      'p.abstract',
      sql<string | null>`to_char(p.published_on, 'YYYY-MM-DD')`.as('published_on'),
      'pmd.doi',
      'pmd.arxiv_id',
      'pmd.openalex_id',
      'pmd.s2_id',
      'p.pdf_url',
      'p.code_url',
      'pmd.tldr',
      'pm.citation_count',
      'pm.hf_upvotes',
      'pm.trend_rank',
      'pmd.openalex_topics',
      'ps.synced_at',
      'ps.sync_error',
      'p.published_at',
      'p.created_at',
      'p.updated_at',
      'editor.username as updated_by',
    ]);

type PaperBody = Partial<z.infer<typeof PaperFields>>;

/**
 * Splits a paper body by where each field is stored: the papers row, paper_metadata (doi,
 * arxiv_id) and the English Paper Card (the Prototype 2 summary). Fields left out stay undefined,
 * which Kysely skips, so a PATCH changes only what was sent.
 */
function splitPaperBody(body: PaperBody) {
  const { field, doi, arxiv_id, research_questions, main_idea, data_source, method_steps, results, figures, limitations, evaluation, ...paper } = body;
  const card = {
    question: research_questions === undefined ? undefined : (research_questions[0] ?? null),
    extra_questions: research_questions?.slice(1),
    key_idea: main_idea,
    data_source,
    method_steps,
    findings: results,
    figures: figures === undefined ? undefined : JSON.stringify(figures), // jsonb: send JSON text
    limitations,
    evaluation,
  };
  return { field, paper, ids: { doi, arxiv_id }, card };
}

/** Writes summary fields from a paper body to the English card, creating it if needed. */
async function writeSummaryToCard(trx: Db, paperId: number, card: ReturnType<typeof splitPaperBody>['card'], userId: number) {
  if (Object.values(card).every((value) => value === undefined)) return;
  await trx
    .insertInto('paper_cards')
    .values({ paper_id: paperId, lang: 'en', ...card, updated_by: userId })
    .onConflict((oc) => oc.columns(['paper_id', 'lang']).doUpdateSet({ ...card, updated_by: userId, updated_at: sql`now()` }))
    .execute();
}

type LinkKind = 'learn_item' | 'quiz' | 'reel';

/** The internal id of a learn item, quiz or live reel that a prerequisite links to, as the matching column. */
async function linkTarget(trx: Db, link: { kind: LinkKind; id: string }) {
  const table = link.kind === 'learn_item' ? 'learn_items' : link.kind === 'quiz' ? 'quizzes' : 'posts';
  const usable = link.kind === 'reel' ? sql`type = 'reel' AND status = 'published' AND deleted_at IS NULL` : sql`true`;
  const result = await sql<{ id: number; ok: boolean }>`SELECT id, ${usable} AS ok FROM ${sql.table(table)} WHERE public_id = ${link.id}`.execute(trx);
  const target = result.rows[0];
  if (!target || !target.ok) throw badRequest(`Unknown ${link.kind.replace('_', ' ')}: ${link.id}`, 'UNKNOWN_REFERENCE');
  return {
    learn_item_id: link.kind === 'learn_item' ? target.id : null,
    quiz_id: link.kind === 'quiz' ? target.id : null,
    reel_post_id: link.kind === 'reel' ? target.id : null,
  };
}

export const adminResearchRoutes: FastifyPluginAsyncZod = async (app) => {
  // ----- Fields (always live) -----
  app.post('/fields', { schema: { body: FieldBody } }, async (request, reply) => {
    const fieldSlug = request.body.slug ?? slugify(request.body.name);
    if (!fieldSlug) throw badRequest('This name has no letters a–z: give the field a slug', 'SLUG_REQUIRED');
    const field = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('fields')
        .values({ name: request.body.name, slug: fieldSlug, description: request.body.description, position: request.body.position })
        .returning(['id', 'slug', 'name', 'description', 'position'])
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
        await trx.updateTable('fields').set(request.body).where('slug', '=', request.params.slug).returning(['id', 'slug', 'name', 'description', 'position']).executeTakeFirst(),
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
      const { paper, ids, card } = splitPaperBody(request.body);
      const row = await trx
        .insertInto('papers')
        .values({
          ...paper,
          title: request.body.title,
          paper_url: request.body.paper_url,
          field_id: await slugToId(trx, 'fields', request.body.field),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await createPaperCompanions(trx, row.id, ids);
      await writeSummaryToCard(trx, row.id, card, request.auth.userId);
      await refreshPaperSearch(trx, row.id);
      await syncSearch(trx, 'papers', row.id);
      await audit(trx, request, { action: 'paper.create', entityType: 'paper', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectPapers().where('p.public_id', '=', paperPublicId).executeTakeFirstOrThrow());
  });

  app.patch('/papers/:id', { schema: { params: idParams, body: updateOf(PaperFields) } }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'papers', request.params.id);
      const { field, paper, ids, card } = splitPaperBody(request.body);
      await trx
        .updateTable('papers')
        .set({ ...paper, field_id: await slugToId(trx, 'fields', field), updated_by: request.auth.userId, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      if (ids.doi !== undefined || ids.arxiv_id !== undefined) {
        await trx.updateTable('paper_metadata').set(ids).where('paper_id', '=', id).execute();
      }
      await writeSummaryToCard(trx, id, card, request.auth.userId);
      await refreshPaperSearch(trx, id);
      await syncSearch(trx, 'papers', id);
      await audit(trx, request, { action: 'paper.update', entityType: 'paper', entityId: id, changes: request.body });
    });
    return selectPapers().where('p.public_id', '=', request.params.id).executeTakeFirstOrThrow();
  });

  /**
   * Replaces the paper's Learn first list, in order. Either `topics` (slugs, the Prototype 2 form)
   * or `items` with a label, why it matters, a link to a learn item, quiz or reel, and whether AI
   * suggested it (the app then shows a footnote).
   */
  app.put(
    '/papers/:id/prerequisites',
    {
      schema: {
        params: idParams,
        body: z.union([
          z.object({ topics: uniqueSlugs }),
          z.object({
            items: z
              .array(PrerequisiteItem)
              .max(30)
              .refine((items) => new Set(items.map((item) => item.topic)).size === items.length, 'Each topic can appear once'),
          }),
        ]),
      },
    },
    async (request, reply) => {
      const items: z.infer<typeof PrerequisiteItem>[] =
        'items' in request.body
          ? request.body.items
          : request.body.topics.map((topic) => ({ topic, label: null, why: null, link: null, suggested_by: 'staff' as const }));
      await db.transaction().execute(async (trx) => {
        const paperId = await contentId(trx, 'papers', request.params.id);
        const rows = [];
        for (const [index, item] of items.entries()) {
          rows.push({
            paper_id: paperId,
            topic_id: await slugToId(trx, 'topics', item.topic),
            position: index + 1,
            label: item.label ?? null,
            why: item.why ?? null,
            suggested_by: item.suggested_by,
            ...(item.link ? await linkTarget(trx, item.link) : { learn_item_id: null, quiz_id: null, reel_post_id: null }),
          });
        }

        await trx.deleteFrom('paper_prerequisites').where('paper_id', '=', paperId).execute();
        if (rows.length) await trx.insertInto('paper_prerequisites').values(rows).execute();
        await trx.updateTable('papers').set({ updated_by: request.auth.userId, updated_at: sql`now()` }).where('id', '=', paperId).execute();
        await audit(trx, request, { action: 'paper.prerequisites', entityType: 'paper', entityId: paperId, changes: request.body });
      });
      return reply.status(204).send();
    },
  );

  /**
   * Adds a paper from its arXiv id or DOI as a draft with an empty title. The worker fills the
   * metadata on its next round (about a minute); the team then writes the cards and publishes.
   */
  app.post('/papers/import', { schema: { body: ImportBody } }, async (request, reply) => {
    const { field, arxiv_id, doi: paperDoi } = request.body;
    const paperPublicId = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('paper_metadata')
        .select('paper_id')
        .where((eb) => (arxiv_id ? eb('arxiv_id', '=', arxiv_id) : eb('doi', '=', paperDoi!)))
        .executeTakeFirst();
      if (existing) throw conflict('This paper is already in the collection', 'ALREADY_EXISTS');
      const row = await trx
        .insertInto('papers')
        .values({
          field_id: await slugToId(trx, 'fields', field),
          title: '',
          paper_url: arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : `https://doi.org/${paperDoi}`,
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        })
        .returning(['id', 'public_id'])
        .executeTakeFirstOrThrow();
      await createPaperCompanions(trx, row.id, { doi: paperDoi, arxiv_id });
      await refreshPaperSearch(trx, row.id);
      await audit(trx, request, { action: 'paper.import', entityType: 'paper', entityId: row.id, changes: request.body });
      return row.public_id;
    });
    return reply.status(201).send(await selectPapers().where('p.public_id', '=', paperPublicId).executeTakeFirstOrThrow());
  });

  /** Queues the paper for the worker's next ingestion round (metadata, citations, references). */
  app.post('/papers/:id/sync', { schema: { params: idParams } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const id = await contentId(trx, 'papers', request.params.id);
      const result = await trx
        .updateTable('paper_sync')
        .set({ synced_at: null, sync_error: null })
        .where('paper_id', '=', id)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('paper_metadata as pmd')
              .whereRef('pmd.paper_id', '=', 'paper_sync.paper_id')
              .where((m) => m.or([m('pmd.doi', 'is not', null), m('pmd.arxiv_id', 'is not', null)]))
              .select(sql.lit(1).as('one')),
          ),
        )
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) throw badRequest('Add a DOI or arXiv id first', 'NO_IDENTIFIER');
      await audit(trx, request, { action: 'paper.sync', entityType: 'paper', entityId: id });
    });
    return reply.status(202).send({ status: 'queued' });
  });

  // ----- Paper Cards in English and Bangla (A2) -----
  app.get('/papers/:id/cards', { schema: { params: idParams } }, async (request) => {
    const items = await db
      .selectFrom('paper_cards as c')
      .innerJoin('papers as p', 'p.id', 'c.paper_id')
      .leftJoin('users as editor', 'editor.id', 'c.updated_by')
      .select([...CARD_COLUMNS.map((column) => `c.${column}` as const), 'editor.username as updated_by'])
      .where('p.public_id', '=', request.params.id)
      .orderBy('c.lang')
      .execute();
    return { items };
  });

  app.put(
    '/papers/:id/cards/:lang',
    { schema: { params: idParams.extend({ lang: z.enum(CONTENT_LANGS) }), body: CardBody } },
    async (request) =>
      db.transaction().execute(async (trx) => {
        const paperId = await contentId(trx, 'papers', request.params.id);
        const { glossary, figures, ...card } = request.body;
        // Undefined values (fields not sent) are skipped by Kysely in both the insert and the update.
        const values = {
          ...card,
          glossary: JSON.stringify(glossary),
          figures: figures === undefined ? undefined : JSON.stringify(figures),
          updated_by: request.auth.userId,
        };
        const row = await trx
          .insertInto('paper_cards')
          .values({ paper_id: paperId, lang: request.params.lang, ...values })
          .onConflict((oc) => oc.columns(['paper_id', 'lang']).doUpdateSet({ ...values, updated_at: sql`now()` }))
          .returning(CARD_COLUMNS)
          .executeTakeFirstOrThrow();
        await refreshPaperSearch(trx, paperId);
        await syncSearch(trx, 'papers', paperId);
        await audit(trx, request, { action: 'paper.card', entityType: 'paper', entityId: paperId, changes: { lang: request.params.lang } });
        return row;
      }),
  );

  app.delete('/papers/:id/cards/:lang', { schema: { params: idParams.extend({ lang: z.enum(CONTENT_LANGS) }) } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const paperId = await contentId(trx, 'papers', request.params.id);
      await trx.deleteFrom('paper_cards').where('paper_id', '=', paperId).where('lang', '=', request.params.lang).execute();
      await refreshPaperSearch(trx, paperId);
      await syncSearch(trx, 'papers', paperId);
      await audit(trx, request, { action: 'paper.card_delete', entityType: 'paper', entityId: paperId, changes: { lang: request.params.lang } });
    });
    return reply.status(204).send();
  });

  // ----- Lineage edges curated by staff (A6) -----
  /**
   * Sets the intent of a citation between two papers, creating the edge if the sources missed it.
   * This is the only way an edge becomes `contrasting`; the worker never overwrites a staff edge's intent.
   */
  app.put('/paper-edges', { schema: { body: EdgeBody } }, async (request, reply) => {
    if (request.body.citing_paper_id === request.body.cited_paper_id) throw badRequest('A paper cannot cite itself');
    await db.transaction().execute(async (trx) => {
      const citing = await contentId(trx, 'papers', request.body.citing_paper_id);
      const cited = await contentId(trx, 'papers', request.body.cited_paper_id);
      await trx
        .insertInto('paper_edges')
        .values({ citing_paper_id: citing, cited_paper_id: cited, intent: request.body.intent, source: 'staff' })
        .onConflict((oc) =>
          oc.columns(['citing_paper_id', 'cited_paper_id']).doUpdateSet({ intent: request.body.intent, source: 'staff', updated_at: sql`now()` }),
        )
        .execute();
      await audit(trx, request, { action: 'paper.edge', entityType: 'paper', entityId: citing, changes: request.body });
    });
    return reply.status(204).send();
  });

  app.delete('/paper-edges', { schema: { body: EdgeBody.omit({ intent: true }) } }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const citing = await contentId(trx, 'papers', request.body.citing_paper_id);
      const cited = await contentId(trx, 'papers', request.body.cited_paper_id);
      await trx.deleteFrom('paper_edges').where('citing_paper_id', '=', citing).where('cited_paper_id', '=', cited).execute();
      await audit(trx, request, { action: 'paper.edge_delete', entityType: 'paper', entityId: citing, changes: request.body });
    });
    return reply.status(204).send();
  });

  await app.register(lifecycleRoutes('/papers', 'papers'));
};
