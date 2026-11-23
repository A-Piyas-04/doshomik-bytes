import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../config/env';

// Scholarly sources for paper ingestion. Only the worker uses these (src/worker/papers.ts):
// the mobile app reads our own database and never waits on an outside API.
//
//   OpenAlex          metadata, abstract, venue, topics, referenced works   (keyless; mailto optional)
//   Semantic Scholar  citation count, TLDR, open-access PDF, references with intents (key optional)
//   Hugging Face      daily papers: trending upvotes and linked code repos   (keyless)

/** Identifiers we may hold for a paper. Any one is enough to look it up. */
export interface PaperRef {
  doi: string | null;
  arxivId: string | null;
  openalexId: string | null;
  s2Id: string | null;
}

export interface OpenAlexWork {
  openalexId: string; // W…
  doi: string | null; // lower case, no https://doi.org/
  title: string | null;
  authors: string[];
  year: number | null;
  publishedOn: string | null; // YYYY-MM-DD
  venue: string | null;
  abstract: string | null;
  citationCount: number | null;
  topics: { id: string; name: string; score: number }[];
  referencedWorks: string[]; // W… ids
}

export interface S2Paper {
  s2Id: string;
  doi: string | null;
  arxivId: string | null;
  citationCount: number | null;
  tldr: string | null;
  pdfUrl: string | null;
  venue: string | null;
}

export interface S2Reference {
  s2Id: string | null;
  doi: string | null;
  arxivId: string | null;
  /** Semantic Scholar's labels: background, methodology, result. */
  intents: string[];
  isInfluential: boolean;
}

export interface HfDailyPaper {
  arxivId: string;
  upvotes: number;
  githubRepo: string | null;
  /** The day it was listed on Hugging Face daily papers. */
  listedAt: string;
}

export interface ScholarlySources {
  openAlex: { work(ref: PaperRef): Promise<OpenAlexWork | null> };
  semanticScholar: {
    paper(ref: PaperRef): Promise<S2Paper | null>;
    references(s2Id: string): Promise<S2Reference[]>;
  };
  huggingFace: { dailyPapers(date: string): Promise<HfDailyPaper[]> };
}

/** A source said "too many requests". The worker stops this round and tries again later. */
export class RateLimitedError extends Error {
  constructor(host: string) {
    super(`${host} is rate limiting us`);
    this.name = 'RateLimitedError';
  }
}

// A generic client name: no user, project or personal details go to outside services.
const USER_AGENT = 'paper-ingest/1.0';

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  const host = new URL(url).host;
  if (response.status === 404) return null;
  if (response.status === 429) throw new RateLimitedError(host);
  if (!response.ok) throw new Error(`${host} answered ${response.status}`);
  return response.json();
}

/** Spaces out calls to one source, so a batch stays under its rate limit. */
function throttle(intervalMs: number) {
  let next = 0;
  return async () => {
    const wait = next - Date.now();
    next = Math.max(Date.now(), next) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

const stripDoi = (value: string | null | undefined) => (value ? value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() : null);
const lastSegment = (value: string) => value.slice(value.lastIndexOf('/') + 1);

/** OpenAlex stores abstracts as an inverted index ({ word: [positions] }). */
function abstractFromIndex(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  const text = words.filter(Boolean).join(' ').trim();
  return text || null;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class OpenAlex {
  private readonly wait = throttle(150);

  async work(ref: PaperRef): Promise<OpenAlexWork | null> {
    const key = ref.openalexId ?? (ref.doi ? `doi:${ref.doi}` : ref.arxivId ? `doi:10.48550/arXiv.${ref.arxivId}` : null);
    if (!key) return null;
    const params = new URLSearchParams({
      select: 'id,doi,title,publication_year,publication_date,primary_location,cited_by_count,topics,referenced_works,authorships,abstract_inverted_index',
    });
    if (env.OPENALEX_MAILTO) params.set('mailto', env.OPENALEX_MAILTO);
    await this.wait();
    const w = (await getJson(`https://api.openalex.org/works/${encodeURI(key)}?${params}`)) as Json | null;
    if (!w) return null;
    return {
      openalexId: lastSegment(String(w.id)),
      doi: stripDoi(w.doi),
      title: w.title ?? null,
      authors: (w.authorships ?? []).map((a: Json) => a.author?.display_name).filter(Boolean),
      year: w.publication_year ?? null,
      publishedOn: w.publication_date ?? null,
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: abstractFromIndex(w.abstract_inverted_index),
      citationCount: w.cited_by_count ?? null,
      topics: (w.topics ?? []).map((t: Json) => ({ id: lastSegment(String(t.id)), name: t.display_name, score: t.score })),
      referencedWorks: (w.referenced_works ?? []).map((id: string) => lastSegment(id)),
    };
  }
}

class SemanticScholar {
  // About 1 request per second with a key; slower without one, where the shared pool is busy.
  private readonly wait = throttle(env.SEMANTIC_SCHOLAR_API_KEY ? 1_100 : 3_000);
  private readonly headers: Record<string, string> = env.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': env.SEMANTIC_SCHOLAR_API_KEY } : {};

  async paper(ref: PaperRef): Promise<S2Paper | null> {
    const key = ref.s2Id ?? (ref.arxivId ? `arXiv:${ref.arxivId}` : ref.doi ? `DOI:${ref.doi}` : null);
    if (!key) return null;
    await this.wait();
    const p = (await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURI(key)}?fields=paperId,externalIds,citationCount,tldr,openAccessPdf,venue`,
      this.headers,
    )) as Json | null;
    if (!p) return null;
    return {
      s2Id: p.paperId,
      doi: stripDoi(p.externalIds?.DOI),
      arxivId: p.externalIds?.ArXiv ?? null,
      citationCount: p.citationCount ?? null,
      tldr: p.tldr?.text ?? null,
      pdfUrl: p.openAccessPdf?.url || null,
      venue: p.venue || null,
    };
  }

  /** The papers this one cites (one page of up to 1000, enough for almost every paper). */
  async references(s2Id: string): Promise<S2Reference[]> {
    await this.wait();
    const body = (await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/${s2Id}/references?fields=paperId,externalIds,intents,isInfluential&limit=1000`,
      this.headers,
    )) as Json | null;
    return (body?.data ?? []).map((r: Json) => ({
      s2Id: r.citedPaper?.paperId ?? null,
      doi: stripDoi(r.citedPaper?.externalIds?.DOI),
      arxivId: r.citedPaper?.externalIds?.ArXiv ?? null,
      intents: r.intents ?? [],
      isInfluential: r.isInfluential === true,
    }));
  }
}

class HuggingFace {
  private readonly wait = throttle(500);

  async dailyPapers(date: string): Promise<HfDailyPaper[]> {
    await this.wait();
    const items = ((await getJson(`https://huggingface.co/api/daily_papers?date=${date}`)) ?? []) as Json[];
    return items
      .filter((item) => typeof item.paper?.id === 'string')
      .map((item) => ({
        arxivId: item.paper.id,
        upvotes: Number(item.paper.upvotes ?? 0),
        githubRepo: item.paper.githubRepo || null,
        listedAt: item.paper.submittedOnDailyAt ?? item.publishedAt ?? `${date}T00:00:00.000Z`,
      }));
  }
}

export const scholarlySources = (): ScholarlySources => ({
  openAlex: new OpenAlex(),
  semanticScholar: new SemanticScholar(),
  huggingFace: new HuggingFace(),
});
