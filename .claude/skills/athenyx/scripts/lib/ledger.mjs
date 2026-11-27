// .athenyx/ledger.json — findings, statuses, checks and decisions across runs.
// The plugin's equivalent of the web app's database (src/lib/review/store.ts,
// recheck.ts, findings/status.ts, decisions/draft.ts).
import { join } from 'node:path';
import { redactSecrets } from './redact.mjs';
import { validateEvidence } from './arbiter.mjs';
import { AthenyxError, CLASSIFICATIONS, asArray, clip, normalizeCode, readJson, titleSimilarity, toEnum, writeJson } from './util.mjs';

export const STATUSES = ['OPEN', 'IN_PROGRESS', 'ACCEPTED_RISK', 'DISMISSED', 'RESOLVED'];
export const ACTIVE = new Set(['OPEN', 'IN_PROGRESS']);
const NOTE_REQUIRED = new Set(['ACCEPTED_RISK', 'DISMISSED', 'RESOLVED']);
const STATUS_ALIASES = {
  open: 'OPEN', reopen: 'OPEN', 'in-progress': 'IN_PROGRESS', in_progress: 'IN_PROGRESS', progress: 'IN_PROGRESS', working: 'IN_PROGRESS',
  accepted: 'ACCEPTED_RISK', accept: 'ACCEPTED_RISK', 'accept-risk': 'ACCEPTED_RISK', risk: 'ACCEPTED_RISK', accepted_risk: 'ACCEPTED_RISK',
  dismissed: 'DISMISSED', dismiss: 'DISMISSED', 'false-positive': 'DISMISSED', wontfix: 'DISMISSED',
  resolved: 'RESOLVED', resolve: 'RESOLVED', fixed: 'RESOLVED', done: 'RESOLVED',
};
export const RECHECK_RESULTS = ['RESOLVED', 'STILL_PRESENT', 'PARTIALLY_RESOLVED', 'UNVERIFIABLE'];

export const ledgerPath = (stateDir) => join(stateDir, 'ledger.json');

export function loadLedger(stateDir) {
  const data = readJson(ledgerPath(stateDir), null);
  if (data && Array.isArray(data.findings)) return data;
  return { version: 1, nextFinding: 1, nextDecision: 1, findings: [], decisions: [], runs: [] };
}

export const saveLedger = (stateDir, ledger) => writeJson(ledgerPath(stateDir), ledger);
export const findById = (ledger, id) => ledger.findings.find((f) => f.id.toLowerCase() === String(id ?? '').trim().toLowerCase());
export const activeFindings = (ledger) => ledger.findings.filter((f) => ACTIVE.has(f.status));

const pad = (n) => String(n).padStart(3, '0');
const history = (f, event, detail, at) => {
  f.history.push({ at, event, detail: clip(detail ?? '', 300) });
  if (f.history.length > 40) f.history.splice(0, f.history.length - 40);
};

/** True when the stored (redacted) snippet no longer appears in the current file, or the file is gone. */
export function citedCodeChanged(evidence, reader) {
  return evidence.some((e) => {
    const lines = reader.lines(e.path);
    if (!lines) return true;
    const snippet = normalizeCode(e.snippet);
    return snippet !== '' && !normalizeCode(redactSecrets(lines.join('\n')).text).includes(snippet);
  });
}

/** Finds the ledger entry a new finding repeats: same primary file, nearby lines, similar title (or identical snippet). */
function findLink(ledger, f, taken) {
  const p = f.evidence[0];
  if (!p) return null;
  let best = null;
  for (const old of ledger.findings) {
    if (taken.has(old.id)) continue;
    const q = old.evidence[0];
    if (!q || q.path !== p.path) continue;
    const near = p.startLine <= q.endLine + 15 && q.startLine <= p.endLine + 15;
    const sim = titleSimilarity(f.title, old.title);
    const sameCode = normalizeCode(p.snippet) !== '' && normalizeCode(p.snippet) === normalizeCode(q.snippet);
    if ((near && sim >= 0.5) || (sameCode && sim >= 0.3)) {
      if (!best || sim > best.sim) best = { old, sim };
    }
  }
  return best?.old ?? null;
}

/**
 * Stores this run's validated findings: repeats link to their ledger entry (a RESOLVED one is
 * reopened), new ones get the next ATX id. Returns the run's findings with id/status/isNew.
 */
export function storeFindings(ledger, findings, run) {
  const taken = new Set();
  const stored = [];
  for (const f of findings) {
    let entry = f.existingId ? findById(ledger, f.existingId) : null;
    if (entry && taken.has(entry.id)) entry = null;
    entry ??= findLink(ledger, f, taken);
    const content = {
      persona: f.persona,
      title: f.title,
      observation: f.observation,
      impact: f.impact,
      classification: f.classification,
      severity: f.severity,
      confidence: f.confidence,
      evidence: f.evidence,
      userPremise: f.userPremise,
      options: f.options,
      recommendation: f.recommendation,
      verification: f.verification,
      alsoRaisedBy: f.alsoRaisedBy,
    };
    if (entry) {
      taken.add(entry.id);
      const wasResolved = entry.status === 'RESOLVED';
      Object.assign(entry, content);
      entry.lastSeen = { runId: run.id, sha: run.sha, at: run.at };
      if (wasResolved) {
        entry.status = 'OPEN';
        entry.statusNote = null;
        entry.checks.push({ at: run.at, runId: run.id, sha: run.sha, result: 'STILL_PRESENT', reasoning: 'Raised again by a later review.', evidence: f.evidence });
        history(entry, 'reopened', `Raised again in ${run.modeLabel} run`, run.at);
      } else history(entry, 'seen', `Raised again in ${run.modeLabel} run`, run.at);
      stored.push({ ...entry, isNew: false });
    } else {
      const id = `ATX-${pad(ledger.nextFinding++)}`;
      const created = {
        id,
        ...content,
        status: 'OPEN',
        statusNote: null,
        chosenOptionIndex: null,
        firstSeen: { runId: run.id, sha: run.sha, at: run.at },
        lastSeen: { runId: run.id, sha: run.sha, at: run.at },
        checks: [],
        history: [],
      };
      history(created, 'found', `First raised in ${run.modeLabel} run by ${f.persona}`, run.at);
      ledger.findings.push(created);
      taken.add(id);
      stored.push({ ...created, isNew: true });
    }
  }
  return stored;
}

/**
 * Active findings the board looked at again but did not raise. Never changes status
 * (only a re-check or the developer can resolve); flags whether the cited code changed.
 */
export function notRaisedAgain(ledger, linkedIds, planItems, reader) {
  const planned = new Map(planItems.map((i) => [i.path, i.ranges]));
  const out = [];
  for (const f of activeFindings(ledger)) {
    if (linkedIds.has(f.id)) continue;
    const e = f.evidence[0];
    const ranges = e ? planned.get(e.path) : null;
    if (!ranges || !ranges.some(([s, t]) => e.startLine <= t + 10 && s <= e.endLine + 10)) continue;
    out.push({ id: f.id, title: f.title, severity: f.severity, persona: f.persona, codeChanged: citedCodeChanged(f.evidence, reader) });
  }
  return out;
}

/** Re-check rules (04 §9.5), ported from src/lib/review/recheck.ts applyRecheckRules. */
export function applyRecheckRules({ result, hasValidEvidence, codeChanged, allFilesDeleted }) {
  if (allFilesDeleted && !hasValidEvidence) {
    return { result: 'UNVERIFIABLE', note: result === 'UNVERIFIABLE' ? null : 'Every cited file was deleted and nothing shows where the logic went, so this cannot be confirmed as resolved.' };
  }
  if (result === 'RESOLVED' && !codeChanged && !hasValidEvidence) {
    return { result: 'UNVERIFIABLE', note: 'Marked unverifiable: the cited code is unchanged and no evidence of a fix was cited.' };
  }
  return { result, note: null };
}

/** Applies the agent's re-check verdicts with the code rules. Returns the outcomes. */
export function applyRechecks(ledger, rechecks, targetIds, run, ctx) {
  const outcomes = [];
  const rejections = [];
  for (const r of asArray(rechecks)) {
    const entry = findById(ledger, r?.id);
    if (!entry || !targetIds.has(entry.id)) {
      rejections.push({ title: String(r?.id ?? '?'), why: 'not one of the findings listed for re-check' });
      continue;
    }
    const proposed = toEnum(r.result, RECHECK_RESULTS, 'UNVERIFIABLE');
    const { evidence, rejected } = validateEvidence(r.evidence, ctx);
    for (const x of rejected) rejections.push({ title: entry.id, why: `citation dropped — ${x.where}: ${x.why}`, partial: true });
    const codeChanged = citedCodeChanged(entry.evidence, ctx.reader);
    const allFilesDeleted = entry.evidence.length > 0 && entry.evidence.every((e) => ctx.reader.lines(e.path) === null);
    const decision = applyRecheckRules({ result: proposed, hasValidEvidence: evidence.length > 0, codeChanged, allFilesDeleted });
    const reasoning = clip(r.reasoning ?? '', 4000) || 'No reasoning given.';
    const check = { at: run.at, runId: run.id, sha: run.sha, result: decision.result, proposed, reasoning: decision.note ? `${reasoning}\n\n${decision.note}` : reasoning, evidence, codeChanged };
    entry.checks.push(check);
    if (entry.checks.length > 20) entry.checks.splice(0, entry.checks.length - 20);
    if (decision.result === 'RESOLVED') {
      entry.status = 'RESOLVED';
      entry.statusNote = `Re-check: resolved at ${run.sha ? run.sha.slice(0, 7) : 'the working tree'}`;
    } else if (decision.result === 'STILL_PRESENT' || decision.result === 'PARTIALLY_RESOLVED') {
      if (evidence.length > 0) entry.evidence = evidence;
      entry.lastSeen = { runId: run.id, sha: run.sha, at: run.at };
      if (entry.status === 'RESOLVED') entry.status = 'OPEN';
    }
    history(entry, 'checked', `Re-check: ${decision.result}${decision.result !== proposed ? ` (proposed ${proposed})` : ''}`, run.at);
    outcomes.push({ id: entry.id, title: entry.title, persona: entry.persona, ...check });
  }
  return { outcomes, rejections };
}

/** `athenyx status <id> <status> "<note>"` (src/lib/findings/status.ts rules). */
export function setStatus(ledger, id, rawStatus, note, at) {
  const entry = findById(ledger, id);
  if (!entry) throw new AthenyxError(`No finding ${id}. Run \`athenyx list\` to see ids.`);
  const status = STATUS_ALIASES[String(rawStatus ?? '').toLowerCase()] ?? toEnum(rawStatus, STATUSES, null);
  if (!status) throw new AthenyxError(`Unknown status "${rawStatus}". Use: open, in-progress, accepted, dismissed, resolved.`);
  const clean = clip(note ?? '', 2000);
  if (NOTE_REQUIRED.has(status) && !clean) throw new AthenyxError(`A note is required to mark ${entry.id} as ${status.toLowerCase().replace('_', ' ')} — say why.`);
  entry.status = status;
  entry.statusNote = status === 'RESOLVED' ? `[manual] ${clean}` : clean || null;
  history(entry, 'status', `${status}${clean ? `: ${clean}` : ''}${status === 'RESOLVED' ? ' (by you, not verified)' : ''}`, at);
  return entry;
}

/** `athenyx decide <id> <option#> "<why>"` — prefill as in src/lib/decisions/draft.ts. */
export function recordDecision(ledger, id, optionNumber, rationale, { at, sha }) {
  const entry = findById(ledger, id);
  if (!entry) throw new AthenyxError(`No finding ${id}. Run \`athenyx list\` to see ids.`);
  const n = Number.parseInt(String(optionNumber ?? ''), 10);
  if (!Number.isInteger(n) || n < 1 || n > entry.options.length) {
    throw new AthenyxError(`${entry.id} has ${entry.options.length} option${entry.options.length === 1 ? '' : 's'}; choose 1${entry.options.length > 1 ? `-${entry.options.length}` : ''}.`);
  }
  const chosen = entry.options[n - 1];
  const decision = {
    id: `DEC-${pad(ledger.nextDecision++)}`,
    title: entry.title,
    findingIds: [entry.id],
    chosenOption: chosen.title,
    optionIndex: n - 1,
    rationale: clip(rationale ?? '', 2000) || entry.recommendation?.rationale || '',
    alternatives: entry.options.filter((_, i) => i !== n - 1).map((o) => ({ title: o.title, whyNot: o.cons.join('; ') })),
    relatedFiles: [...new Set(entry.evidence.map((e) => e.path))],
    context: entry.observation,
    status: 'ACCEPTED',
    at,
    sha,
  };
  ledger.decisions.push(decision);
  entry.chosenOptionIndex = n - 1;
  if (entry.status === 'OPEN') entry.status = 'IN_PROGRESS';
  history(entry, 'decided', `${decision.id}: chose "${chosen.title}"`, at);
  return decision;
}

export const isClassification = (v) => CLASSIFICATIONS.includes(v);
