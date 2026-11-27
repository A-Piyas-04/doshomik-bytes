// Small shared helpers. Zero dependencies, Node >= 18.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export const VERSION = '1.0.0';

/** Repo-relative POSIX path without "./" or trailing "/". */
export function normPath(p) {
  return String(p ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** Collapses whitespace so formatting differences don't break a quote match. */
export const normalizeCode = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export const clip = (text, max) => {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Writes JSON atomically (temp file + rename) so a crash never leaves half a ledger. */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Local-time stamp for file names: 2026-11-27_14-03-22 */
export function fileStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Minimal argv parser: positionals plus --flag / --flag value / --flag=value.
 * Boolean flags are listed so "--open foo" doesn't swallow a positional.
 */
export function parseArgs(argv, booleans = []) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (booleans.includes(name)) flags[name] = true;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
    } else positionals.push(a);
  }
  return { positionals, flags };
}

/** Words of a title for similarity (stopwords removed). Ported from src/lib/review/dedupe.ts. */
const STOPWORDS = new Set(
  'a an the and or of in on for to with without by from at is are be can may could not no this that it its as into via when while missing lack lacks potential possible'.split(' '),
);
export function titleWords(title) {
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}
export function titleSimilarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / Math.min(wa.size, wb.size);
}

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'];
export const CLASSIFICATIONS = ['VERIFIED_DEFECT', 'POTENTIAL_RISK', 'DESIGN_CONCERN'];
export const SEVERITY_ORDER = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
export const CONFIDENCE_ORDER = Object.fromEntries(CONFIDENCES.map((s, i) => [s, i]));

/** Case/spacing-tolerant enum coercion ("potential risk" → POTENTIAL_RISK). */
export function toEnum(value, allowed, fallback) {
  const v = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return allowed.includes(v) ? v : fallback;
}

export const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
export const asInt = (v) => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** An error meant for the user or the agent: printed as one line, never with a stack. */
export class AthenyxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AthenyxError';
  }
}
