import { PAPER_TRENDING_DAYS, type PaperEdgeIntent } from '@doshomik/shared';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { env } from '../config/env';
import { db, type Db } from '../db';
import { refreshPaperSearch } from '../db/search';
import { providers } from '../providers';
import { RateLimitedError, type S2Reference } from '../providers/scholarly';

// Paper ingestion (Research tab A1, A6). The worker fills our tables from OpenAlex, Semantic
// Scholar and Hugging Face; the API only ever reads them. Every job here is safe to repeat.
// Since migration 006 a paper's data is spread by responsibility: descriptive fields on papers,
// outside ids and TLDR on paper_metadata, counts and rank on paper_metrics, the queue on paper_sync.

/** How often a paper's metadata, citation count and references are refreshed. */
const REFRESH_DAYS = 7;
/** Papers synced per round; each takes about 3 outside requests. */
const BATCH = 10;
/** Hugging Face daily papers are read for this many recent days, every TRENDING_EVERY_MS. */
const TRENDING_LOOKBACK_DAYS = 7;
const TRENDING_EVERY_MS = 6 * 3600_000;

let lastTrendingRun = 0;

/**
 * One round of the worker's papers loop: trending data every 6 hours, then a batch of papers that
 * are new or due a refresh, then the trend ranking if anything changed. Returns true while papers
 * are waiting, so the loop goes again without sleeping.
 */
export async function runPaperSync(log: Logger): Promise<boolean> {
  if (!env.PAPER_SYNC_ENABLED) return false;
  let changed = false;
  if (Date.now() - lastTrendingRun > TRENDING_EVERY_MS) {
    lastTrendingRun = Date.now(); // set first, so a failing source isn't retried every minute
    changed = (await syncTrending(log)) > 0;
  }
  const synced = await syncDuePapers(log);
  if (changed || synced > 0) await rankPapers();
  return synced === BATCH;
}

type DuePaper = { id: number; doi: string | null; arxiv_id: string | null; openalex_id: string | null; s2_id: string | null };

/** Papers never synced (imports, or "sync now") first, then the stalest. */
export async function syncDuePapers(log: Logger, limit = BATCH): Promise<number> {
  const papers: DuePaper[] = await db
    .selectFrom('paper_sync as ps')
    .innerJoin('paper_metadata as pmd', 'pmd.paper_id', 'ps.paper_id')
    .select(['ps.paper_id as id', 'pmd.doi', 'pmd.arxiv_id', 'pmd.openalex_id', 'pmd.s2_id'])
    // Only papers with an identifier can be looked up.
    .where((eb) => eb.or([eb('pmd.doi', 'is not', null), eb('pmd.arxiv_id', 'is not', null)]))
    .where((eb) => eb.or([eb('ps.synced_at', 'is', null), eb('ps.synced_at', '<', new Date(Date.now() - REFRESH_DAYS * 86_400_000))]))
    // Same order as paper_sync_due_idx.
    .orderBy(sql`ps.synced_at NULLS FIRST`)
    .orderBy('ps.paper_id')
    .limit(limit)
    .execute();

  let done = 0;
  for (const paper of papers) {
    try {
      await syncPaper(paper);
      done++;
    } catch (error) {
      if (error instanceof RateLimitedError) {
        log.warn({ err: error }, 'Paper sync paused by a rate limit');
        break; // leave the rest for the next round
      }
      log.warn({ err: error, paperId: paper.id }, 'Paper sync failed');
      await db
        .updateTable('paper_sync')
        .set({ synced_at: new Date(), sync_error: String((error as Error).message).slice(0, 500) })
        .where('paper_id', '=', paper.id)
        .execute();
      done++;
    }
  }
  return done;
}

/**
 * Fetches one paper from OpenAlex and Semantic Scholar and stores what it found. Descriptive fields
 * (title, authors, venue, abstract…) are only filled when empty, so staff edits win; counts, TLDR
 * and ids are refreshed every time. References become paper_edges.
 */
export async function syncPaper(paper: DuePaper): Promise<void> {
  const ref = { doi: paper.doi, arxivId: paper.arxiv_id, openalexId: paper.openalex_id, s2Id: paper.s2_id };
  const work = await providers.scholarly.openAlex.work(ref);
  const s2 = await providers.scholarly.semanticScholar.paper(ref);
  const references = s2 ? await providers.scholarly.semanticScholar.references(s2.s2Id) : [];

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('papers')
      .set({
        // An import starts with an empty title until its first sync.
        title: sql`coalesce(nullif(title, ''), ${work?.title ?? null}, title)`,
        authors: sql`coalesce(authors, ${work?.authors.length ? work.authors.join(', ') : null})`,
        year: sql`coalesce(year, ${work?.year ?? null}::smallint)`,
        venue: sql`coalesce(venue, ${work?.venue ?? s2?.venue ?? null})`,
        abstract: sql`coalesce(abstract, ${work?.abstract ?? null})`,
        published_on: sql`coalesce(published_on, ${work?.publishedOn ?? null}::date)`,
        pdf_url: sql`coalesce(pdf_url, ${s2?.pdfUrl ?? null})`,
      })
      .where('id', '=', paper.id)
      .execute();
    await trx
      .updateTable('paper_metadata')
      .set({
        doi: sql`coalesce(doi, ${work?.doi ?? s2?.doi ?? null})`,
        arxiv_id: sql`coalesce(arxiv_id, ${s2?.arxivId ?? null})`,
        openalex_id: sql`coalesce(${work?.openalexId ?? null}, openalex_id)`,
        s2_id: sql`coalesce(${s2?.s2Id ?? null}, s2_id)`,
        tldr: sql`coalesce(${s2?.tldr ?? null}, tldr)`,
        openalex_topics: work ? JSON.stringify(work.topics) : sql`openalex_topics`,
      })
      .where('paper_id', '=', paper.id)
      .execute();
    await trx
      .updateTable('paper_metrics')
      .set({ citation_count: sql`coalesce(${s2?.citationCount ?? work?.citationCount ?? null}::int, citation_count)` })
      .where('paper_id', '=', paper.id)
      .execute();
    await trx.updateTable('paper_sync').set({ synced_at: new Date(), sync_error: null }).where('paper_id', '=', paper.id).execute();
    await replaceEdges(trx, paper.id, references, work?.referencedWorks ?? []);
    await refreshPaperSearch(trx, paper.id);
  });
}

/**
 * Semantic Scholar labels a citation background, methodology or result. We keep those labels and
 * map them onto ours without guessing: methodology (the paper builds on the cited method) is
 * supporting, background is background, and result alone stays unknown, because it can support or
 * dispute. Contrasting is only ever set by staff.
 */
function intentOf(intents: string[]): PaperEdgeIntent | null {
  if (intents.includes('methodology')) return 'supporting';
  if (intents.includes('background')) return 'background';
  return null;
}

type Edge = { cited: number; intent: PaperEdgeIntent | null; s2Intents: string[]; influential: boolean; source: 'semantic_scholar' | 'openalex' };

/** Rewrites the paper's outgoing edges to papers in our collection. Staff edges are never changed. */
async function replaceEdges(trx: Db, citingId: number, references: S2Reference[], openalexWorks: string[]): Promise<void> {
  const s2Ids = references.flatMap((r) => (r.s2Id ? [r.s2Id] : []));
  const dois = references.flatMap((r) => (r.doi ? [r.doi] : []));
  const arxivIds = references.flatMap((r) => (r.arxivId ? [r.arxivId] : []));
  const ours =
    s2Ids.length || dois.length || arxivIds.length || openalexWorks.length
      ? await trx
          .selectFrom('paper_metadata')
          .select(['paper_id as id', 's2_id', 'doi', 'arxiv_id', 'openalex_id'])
          .where((eb) =>
            eb.or([
              ...(s2Ids.length ? [eb('s2_id', 'in', s2Ids)] : []),
              ...(dois.length ? [eb('doi', 'in', dois)] : []),
              ...(arxivIds.length ? [eb('arxiv_id', 'in', arxivIds)] : []),
              ...(openalexWorks.length ? [eb('openalex_id', 'in', openalexWorks)] : []),
            ]),
          )
          .execute()
      : [];

  const edges = new Map<number, Edge>();
  for (const r of references) {
    const match = ours.find((p) => (r.s2Id && p.s2_id === r.s2Id) || (r.doi && p.doi === r.doi) || (r.arxivId && p.arxiv_id === r.arxivId));
    if (match && match.id !== citingId) {
      edges.set(match.id, { cited: match.id, intent: intentOf(r.intents), s2Intents: r.intents, influential: r.isInfluential, source: 'semantic_scholar' });
    }
  }
  for (const work of openalexWorks) {
    const match = ours.find((p) => p.openalex_id === work);
    if (match && match.id !== citingId && !edges.has(match.id)) {
      edges.set(match.id, { cited: match.id, intent: null, s2Intents: [], influential: false, source: 'openalex' });
    }
  }

  await trx
    .deleteFrom('paper_edges')
    .where('citing_paper_id', '=', citingId)
    .where('source', '!=', 'staff')
    .$if(edges.size > 0, (qb) => qb.where('cited_paper_id', 'not in', [...edges.keys()]))
    .execute();
  if (!edges.size) return;
  await trx
    .insertInto('paper_edges')
    .values(
      [...edges.values()].map((e) => ({
        citing_paper_id: citingId,
        cited_paper_id: e.cited,
        intent: e.intent,
        s2_intents: e.s2Intents,
        is_influential: e.influential,
        source: e.source,
      })),
    )
    .onConflict((oc) =>
      oc.columns(['citing_paper_id', 'cited_paper_id']).doUpdateSet({
        // A staff edge keeps its intent and source; the source's labels are still refreshed.
        intent: sql`CASE WHEN paper_edges.source = 'staff' THEN paper_edges.intent ELSE excluded.intent END`,
        source: sql`CASE WHEN paper_edges.source = 'staff' THEN 'staff' ELSE excluded.source END`,
        s2_intents: sql`excluded.s2_intents`,
        is_influential: sql`excluded.is_influential`,
        updated_at: sql`now()`,
      }),
    )
    .execute();
}

/**
 * Hugging Face daily papers for the last week: upvotes, the day a paper was listed, and its code
 * repo, for papers in our collection (matched by arXiv id). Returns how many papers it updated.
 */
export async function syncTrending(log: Logger): Promise<number> {
  const seen = new Map<string, { upvotes: number; repo: string | null; listedAt: string }>();
  for (let back = 0; back < TRENDING_LOOKBACK_DAYS; back++) {
    const date = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    try {
      for (const item of await providers.scholarly.huggingFace.dailyPapers(date)) {
        const known = seen.get(item.arxivId);
        if (!known || item.listedAt > known.listedAt) seen.set(item.arxivId, { upvotes: item.upvotes, repo: item.githubRepo, listedAt: item.listedAt });
      }
    } catch (error) {
      log.warn({ err: error, date }, 'Hugging Face daily papers failed');
      if (error instanceof RateLimitedError) break;
    }
  }
  if (!seen.size) return 0;

  const rows = [...seen.entries()].map(
    ([arxivId, v]) => sql`(${arxivId}::text, ${v.upvotes}::int, ${v.repo}::text, ${v.listedAt}::timestamptz)`,
  );
  // Matched through paper_metadata.arxiv_id; the counts go to paper_metrics, a missing code link to papers.
  const { rows: updated } = await sql<{ n: number }>`
    WITH v (arxiv_id, upvotes, repo, listed_at) AS (VALUES ${sql.join(rows)}),
    matched AS (SELECT pmd.paper_id, v.upvotes, v.repo, v.listed_at FROM v JOIN paper_metadata pmd ON pmd.arxiv_id = v.arxiv_id),
    code AS (
      UPDATE papers p SET code_url = m.repo
      FROM matched m WHERE p.id = m.paper_id AND p.code_url IS NULL AND m.repo IS NOT NULL
    ),
    metrics AS (
      UPDATE paper_metrics pm SET
        hf_upvotes = m.upvotes,
        hf_trending_at = greatest(coalesce(pm.hf_trending_at, m.listed_at), m.listed_at)
      FROM matched m WHERE pm.paper_id = m.paper_id
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM metrics`.execute(db);
  return updated[0]?.n ?? 0;
}

/**
 * The default Research order, 1..n over published papers: papers trending on Hugging Face in the
 * last PAPER_TRENDING_DAYS first (most upvoted first), then by citation count, then newest.
 */
export async function rankPapers(): Promise<void> {
  const trending = sql`(m2.hf_trending_at >= now() - make_interval(days => ${PAPER_TRENDING_DAYS}))`;
  await sql`
    UPDATE paper_metrics pm SET trend_rank = r.rank
    FROM (
      SELECT p2.id, row_number() OVER (ORDER BY
        ${trending} IS TRUE DESC,
        CASE WHEN ${trending} THEN m2.hf_upvotes END DESC NULLS LAST,
        m2.citation_count DESC NULLS LAST,
        p2.published_on DESC NULLS LAST,
        p2.id DESC) AS rank
      FROM papers p2
      JOIN paper_metrics m2 ON m2.paper_id = p2.id
      WHERE p2.status = 'published'
    ) r
    WHERE r.id = pm.paper_id AND pm.trend_rank IS DISTINCT FROM r.rank`.execute(db);
  // Only published papers keep a rank (the list query still checks papers.status).
  await sql`
    UPDATE paper_metrics pm SET trend_rank = NULL
    FROM papers p
    WHERE p.id = pm.paper_id AND p.status <> 'published' AND pm.trend_rank IS NOT NULL`.execute(db);
}
