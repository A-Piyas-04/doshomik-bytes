// The Evidence Arbiter — deterministic code, not an AI. Ported from the web app
// (src/lib/review/validate.ts, dedupe.ts). The model's text is never trusted for
// paths, line numbers or snippets: every quote is checked against the real file,
// and the stored snippet is copied from disk (with secrets redacted).
import { isAbsolute, relative, resolve } from 'node:path';
import { PERSONAS, ALL_PERSONAS, resolvePersonaList } from './personas.mjs';
import { redactSecrets } from './redact.mjs';
import {
  CLASSIFICATIONS, CONFIDENCES, CONFIDENCE_ORDER, SEVERITIES, SEVERITY_ORDER,
  asArray, asInt, clip, normPath, normalizeCode, titleSimilarity, toEnum,
} from './util.mjs';

export const MAX_EVIDENCE_SPAN = 30;
export const REANCHOR_WINDOW = 10;
export const MAX_FINDINGS_PER_PERSONA = 4;
const MIN_QUOTE_CHARS = 4;
const TITLE_SIMILARITY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

const unescape = (q) => String(q ?? '').replace(/\r\n?/g, '\n').replaceAll('<\\/', '</').trim();
/** Line-number prefixes file readers add: "   12\t", "12| ", "12: ", "L12: ". */
const stripPrefixes = (q) => q.split('\n').map((l) => l.replace(/^\s*(?:L?\d+\t|L?\d+\s?[|│]\s?|L?\d+:\s)/, '')).join('\n').trim();
const stripDiff = (q) => {
  const lines = q.split('\n');
  return lines.every((l) => /^[+\- ]/.test(l) || l === '') ? lines.map((l) => l.slice(1)).join('\n').trim() : null;
};

function locateCleaned(lines, startLine, endLine, cleaned) {
  const needle = normalizeCode(cleaned);
  if (needle.length < MIN_QUOTE_CHARS || lines.length === 0) return null;
  const matches = (s, e) => s >= 1 && e <= lines.length && s <= e && normalizeCode(lines.slice(s - 1, e).join('\n')).includes(needle);
  const narrow = (s, e) => {
    let a = s;
    let b = e;
    while (a < b && matches(a + 1, b)) a += 1;
    while (b > a && matches(a, b - 1)) b -= 1;
    return { startLine: a, endLine: b };
  };
  const lo = Math.min(startLine ?? 1, endLine ?? startLine ?? 1);
  const hi = Math.max(startLine ?? 1, endLine ?? startLine ?? 1);
  const s0 = Math.max(1, lo);
  const e0 = Math.min(lines.length, hi);
  if (matches(s0, e0)) return narrow(s0, e0);
  const span = Math.max(1, cleaned.split('\n').length);
  for (let d = 0; d <= REANCHOR_WINDOW; d += 1) {
    for (const s of d === 0 ? [lo] : [lo - d, lo + d]) for (const e of [s + span - 1, s + span]) if (matches(s, e)) return narrow(s, e);
  }
  // Beyond ±10 lines the exact quote is still proof — but only if it occurs exactly once.
  let hit = null;
  for (let s = 1; s + span - 1 <= lines.length; s += 1) {
    if (!matches(s, s + span - 1)) continue;
    const found = narrow(s, s + span - 1);
    if (hit && hit.startLine !== found.startLine) return null;
    hit = found;
    s = found.endLine;
  }
  return hit;
}

/** Finds where `quote` really is: cited range, ±10 lines, then a unique match anywhere. */
export function locateQuote(lines, startLine, endLine, quote) {
  const raw = unescape(quote);
  const attempts = [raw, stripPrefixes(raw), stripDiff(raw), stripDiff(stripPrefixes(raw))].filter((q, i, all) => q && all.indexOf(q) === i);
  for (const q of attempts) {
    const found = locateCleaned(lines, startLine, endLine, q);
    if (found) return found;
  }
  return null;
}

/** Repo-relative path from what the agent wrote (relative, absolute inside the repo, or "./x"). */
export function toRepoPath(root, raw) {
  const p = String(raw ?? '').trim();
  if (!p) return '';
  if (isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) {
    const rel = relative(resolve(root), resolve(p));
    if (rel.startsWith('..') || isAbsolute(rel)) return '';
    return normPath(rel);
  }
  return normPath(p);
}

/** Validates evidence items against disk. Returns { evidence, rejected: [{ path, lines, why }] }. */
export function validateEvidence(items, { root, reader, sha }) {
  const evidence = [];
  const rejected = [];
  const seen = new Set();
  const redactedCache = new Map();
  for (const item of asArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const path = toRepoPath(root, item.path ?? item.file);
    const start = asInt(item.startLine ?? item.start ?? item.line);
    const end = asInt(item.endLine ?? item.end) ?? start;
    const where = `${path || item.path}:${start ?? '?'}${end && end !== start ? `-${end}` : ''}`;
    const lines = path ? reader.lines(path) : null;
    if (!lines) {
      rejected.push({ where, why: path ? 'file not found, outside the repo, or excluded (secret/ignored/binary)' : 'missing or invalid path' });
      continue;
    }
    const located = locateQuote(lines, start ?? 1, end ?? start ?? 1, item.quote ?? item.code ?? '');
    if (!located) {
      rejected.push({ where, why: normalizeCode(item.quote).length < MIN_QUOTE_CHARS ? 'quote missing or too short' : 'quote not found in the file (copy 1–3 lines exactly)' });
      continue;
    }
    const s = located.startLine;
    const e = Math.min(located.endLine, s + MAX_EVIDENCE_SPAN - 1);
    const key = `${path}:${s}-${e}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!redactedCache.has(path)) redactedCache.set(path, redactSecrets(lines.join('\n')).text.split('\n'));
    const red = redactedCache.get(path);
    evidence.push({
      path,
      startLine: s,
      endLine: e,
      symbol: item.symbol && String(item.symbol).trim() ? clip(item.symbol, 200) : null,
      snippet: red.slice(s - 1, e).join('\n'),
      commitSha: sha,
    });
  }
  return { evidence, rejected };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const text = (v, max = 4000) => clip(v ?? '', max);
const list = (v) => asArray(v).map((s) => text(s, 500)).filter(Boolean).slice(0, 6);
const capConfidence = (value, max) => (CONFIDENCE_ORDER[value] < CONFIDENCE_ORDER[max] ? max : value);
const PREMISE_MODES = new Set(['proposal', 'issue']);

function personaKey(raw, fallback) {
  if (ALL_PERSONAS.includes(raw)) return raw;
  const { personas } = resolvePersonaList(raw);
  return personas[0] ?? fallback;
}

/**
 * Applies the finding-level rules (04 §7.2) to everything the agent wrote.
 * Returns { findings, stats, rejections }.
 */
export function validateFindings(raw, { mode, seated, root, reader, sha, knownIds }) {
  const byPersona = new Map();
  for (const f of asArray(raw)) {
    if (!f || typeof f !== 'object') continue;
    const persona = personaKey(String(f.persona ?? f.lens ?? f.specialist ?? '').trim(), seated[0] ?? 'quality');
    if (!byPersona.has(persona)) byPersona.set(persona, []);
    byPersona.get(persona).push(f);
  }
  const stats = {};
  const rejections = [];
  const out = [];
  for (const [persona, findings] of byPersona) {
    const st = (stats[persona] = { raised: findings.length, unsupported: 0, citationsDropped: 0, overCap: 0 });
    findings.forEach((f, i) => {
      if (i >= MAX_FINDINGS_PER_PERSONA) {
        st.overCap += 1;
        rejections.push({ persona, title: text(f.title, 100), why: `more than ${MAX_FINDINGS_PER_PERSONA} findings for this lens; keep the most important` });
        return;
      }
      const { evidence, rejected } = validateEvidence(f.evidence, { root, reader, sha });
      st.citationsDropped += rejected.length;
      const userPremise = f.userPremise && String(f.userPremise).trim() ? text(f.userPremise, 2000) : null;
      const premiseAllowed = PREMISE_MODES.has(mode) && userPremise !== null;
      const title = text(f.title, 100) || 'Untitled finding';
      if (evidence.length === 0 && !premiseAllowed) {
        st.unsupported += 1;
        rejections.push({ persona, title, why: rejected.length ? rejected.map((r) => `${r.where}: ${r.why}`).join('; ') : 'no evidence given' });
        return;
      }
      for (const r of rejected) rejections.push({ persona, title, why: `citation dropped — ${r.where}: ${r.why}`, partial: true });

      let classification = toEnum(f.classification, CLASSIFICATIONS, 'POTENTIAL_RISK');
      let confidence = toEnum(f.confidence, CONFIDENCES, 'MEDIUM');
      let severity = toEnum(f.severity, SEVERITIES, 'MEDIUM');
      if (evidence.length === 0) {
        if (classification === 'VERIFIED_DEFECT') classification = mode === 'proposal' ? 'DESIGN_CONCERN' : 'POTENTIAL_RISK';
        confidence = capConfidence(confidence, 'MEDIUM');
      }
      if (classification === 'VERIFIED_DEFECT' && !(evidence.length > 0 && confidence === 'HIGH')) classification = 'POTENTIAL_RISK';
      if (severity === 'CRITICAL' && confidence === 'LOW') severity = 'HIGH';

      const kept = asArray(f.options)
        .map((o, originalIndex) => ({ o: o && typeof o === 'object' ? o : { title: String(o ?? '') }, originalIndex }))
        .filter(({ o }) => String(o.title ?? '').trim() !== '')
        .slice(0, 3);
      const options = kept.map(({ o }) => ({
        title: text(o.title, 200),
        description: text(o.description, 2000),
        pros: list(o.pros),
        cons: list(o.cons),
        effort: toEnum(o.effort, ['SMALL', 'MEDIUM', 'LARGE'], null),
      }));
      const rec = f.recommendation && typeof f.recommendation === 'object' ? f.recommendation : {};
      const idx = asInt(rec.optionIndex);
      const mapped = idx === null ? -1 : kept.findIndex((k) => k.originalIndex === idx);
      const rationale = text(rec.rationale, 2000);
      const existing = String(f.existingId ?? f.existingFindingId ?? '').trim();
      out.push({
        persona,
        existingId: existing && knownIds.has(existing) ? existing : null,
        title,
        observation: text(f.observation),
        impact: text(f.impact),
        classification,
        severity,
        confidence,
        evidence,
        userPremise,
        options,
        recommendation: mapped < 0 && !rationale ? null : { optionIndex: mapped >= 0 ? mapped : null, rationale },
        verification: text(f.verification),
        alsoRaisedBy: [],
      });
    });
  }
  return { findings: out, stats, rejections };
}

const overlaps = (a, b) => a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine;
export const isDuplicate = (a, b) => {
  const pa = a.evidence[0];
  const pb = b.evidence[0];
  return Boolean(pa && pb && overlaps(pa, pb) && titleSimilarity(a.title, b.title) >= TITLE_SIMILARITY_THRESHOLD);
};
const rank = (f) => [SEVERITY_ORDER[f.severity], CONFIDENCE_ORDER[f.confidence]];
const outranks = (a, b) => {
  const [sa, ca] = rank(a);
  const [sb, cb] = rank(b);
  return sa < sb || (sa === sb && ca < cb);
};

function merge(kept, other) {
  const evidence = [...kept.evidence];
  for (const e of other.evidence) if (!evidence.some((x) => x.path === e.path && x.startLine === e.startLine && x.endLine === e.endLine)) evidence.push(e);
  const useOther = other.options.length > kept.options.length;
  const alsoRaisedBy = [...kept.alsoRaisedBy];
  for (const p of [other.persona, ...other.alsoRaisedBy]) if (p !== kept.persona && !alsoRaisedBy.includes(p)) alsoRaisedBy.push(p);
  return {
    ...kept,
    existingId: kept.existingId ?? other.existingId,
    evidence,
    options: useOther ? other.options : kept.options,
    recommendation: useOther ? other.recommendation : kept.recommendation,
    userPremise: kept.userPremise ?? other.userPremise,
    alsoRaisedBy,
  };
}

/** Merges duplicates (overlap + similar title, or the same existing id). Returns { findings, merged }. */
export function dedupeFindings(findings) {
  const result = [];
  let merged = 0;
  for (const f of findings) {
    const i = result.findIndex((x) => (f.existingId && f.existingId === x.existingId) || isDuplicate(x, f));
    if (i === -1) {
      result.push(f);
      continue;
    }
    merged += 1;
    result[i] = outranks(f, result[i]) ? merge(f, result[i]) : merge(result[i], f);
  }
  return { findings: result, merged };
}

/** Sorts by severity then confidence and keeps the top `max`. */
export function sortAndCap(findings, max) {
  const sorted = [...findings].sort((a, b) => {
    const [sa, ca] = rank(a);
    const [sb, cb] = rank(b);
    return sa - sb || ca - cb;
  });
  return { kept: sorted.slice(0, max), omitted: Math.max(0, sorted.length - max) };
}

/** A specialist's stance, derived from its findings that survived the Arbiter (board.ts deriveStance). */
export function deriveStance(findings) {
  if (findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')) return 'serious';
  if (findings.length > 0) return 'concerns';
  return 'clear';
}

export const STANCE_LABEL = { serious: 'Flags serious issues', concerns: 'Has concerns', clear: 'Signs off', absent: 'Not seated' };

export const personaInfo = (key) => PERSONAS[key] ?? { name: key, short: key, focus: '' };
