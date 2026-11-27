#!/usr/bin/env node
// Athenyx CLI — the deterministic half of the Athenyx review board. Zero dependencies, Node >= 18.
//
//   scan [mode] [text…] [--all] [--personas a,b] [--depth quick|standard|deep] [--base <ref>]
//        modes: health (default) · changes · ask · proposal · issue · release · recheck [ATX-…]
//   build [--open] [--accept]        validate .athenyx/findings.json → HTML report
//   decide <id> <option#> "<why>"    record a decision (Solution Lab → Decision Ledger)
//   status <id> <status> ["<note>"]  open · in-progress · accepted · dismissed · resolved
//   list                             open findings, decisions and reports
//   report [--open]                  re-render the latest run with the current ledger
//   install <target> [--project] [--path <dir>] [--dry-run]   claude · agents · antigravity · gemini · all
//   doctor                           check Node, git and write access
//
// The AI never writes HTML and never decides what is evidence: this CLI picks what to read,
// verifies every quote against the real file, and renders the report.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStance, dedupeFindings, sortAndCap, validateFindings, STANCE_LABEL } from './lib/arbiter.mjs';
import { createReader, listFiles, MAX_SCANNED_FILES, isTestPath } from './lib/files.mjs';
import { commitExists, defaultBase, diffSince, gitInfo, hunkRanges, repoRoot } from './lib/git.mjs';
import { personaScores, scanHotspots } from './lib/hotspots.mjs';
import { install, INSTALL_TARGETS } from './lib/install.mjs';
import {
  activeFindings, applyRechecks, findById, loadLedger, notRaisedAgain, recordDecision, saveLedger, setStatus, storeFindings,
} from './lib/ledger.mjs';
import { buildProjectMap, isCodePath, renderTree } from './lib/map.mjs';
import { ALL_PERSONAS, ARBITER, CORE, MODES, MODE_ALIASES, PERSONAS, RULES, resolvePersonaList } from './lib/personas.mjs';
import { applyVerdictCaps, RELEASE_DISCLAIMER } from './lib/release.mjs';
import { displayPath, openInBrowser, reportFileName, writeIndex, writeReport } from './lib/render.mjs';
import { buildReadingPlan, formatRanges, keywordsFrom, selectPersonas } from './lib/route.mjs';
import { AthenyxError, CONFIDENCE_ORDER, SEVERITIES, SEVERITY_ORDER, VERSION, asArray, clip, fileStamp, normalizeCode, parseArgs, readJson, toEnum, writeJson } from './lib/util.mjs';

const CLI = fileURLToPath(import.meta.url);
const CLI_CMD = `node "${CLI}"`;
const argv = process.argv.slice(2);
const command = (argv[0] ?? 'help').toLowerCase();
const { positionals, flags } = parseArgs(argv.slice(1), ['open', 'accept', 'all', 'project', 'dry-run', 'force', 'json', 'no-open']);

const fail = (message) => {
  throw new AthenyxError(message);
};

function locate() {
  const start = resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
  const root = typeof flags.root === 'string' ? start : (repoRoot(start) ?? start);
  return { root, stateDir: join(root, '.athenyx'), reportsDir: join(root, 'athenyx-reports') };
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

function parseMode() {
  const words = [...positionals];
  let mode = 'health';
  if (words.length > 0 && MODE_ALIASES[words[0].toLowerCase()]) mode = MODE_ALIASES[words.shift().toLowerCase()];
  else if (words.length > 0) mode = words.join(' ').trim().endsWith('?') ? 'ask' : 'health';
  let text = words.join(' ').trim();
  if (typeof flags.text === 'string') text = flags.text.trim();
  return { mode, text: clip(text, 4000) };
}

function scan() {
  const { root, stateDir } = locate();
  const { mode, text } = parseMode();
  const cfg = MODES[mode];
  if (cfg.needs && !text) fail(`"${mode}" needs your ${cfg.needs}. Example: ${CLI_CMD} scan ${mode} "…"`);
  const depth = toEnum(flags.depth ?? 'standard', ['QUICK', 'STANDARD', 'DEEP'], 'STANDARD').toLowerCase();
  const at = new Date().toISOString();

  const { files: allFiles, excluded } = listFiles(root);
  if (allFiles.length === 0) fail(`No readable files under ${root}. Run Athenyx from the project folder.`);
  const reader = createReader(root);
  const map = buildProjectMap(allFiles, reader);
  const git = gitInfo(root);
  const ledger = loadLedger(stateDir);

  // Hotspot scan (bounded on very large repos: code first, tests last).
  let scanFiles = allFiles;
  const limitations = [];
  if (allFiles.length > MAX_SCANNED_FILES) {
    scanFiles = [...allFiles].sort((a, b) => Number(!isCodePath(a.path)) - Number(!isCodePath(b.path)) || Number(isTestPath(a.path)) - Number(isTestPath(b.path))).slice(0, MAX_SCANNED_FILES);
    limitations.push(`Large repository: hotspot detection scanned ${MAX_SCANNED_FILES} of ${allFiles.length} files.`);
  }
  const { hits, fileLines } = scanHotspots(scanFiles, reader, map);

  // Latest Changes: diff against the last Athenyx run (or the default branch) plus uncommitted edits.
  let diff = null;
  if (mode === 'changes') {
    if (!git.isRepo) fail('"changes" needs a git repository. Use: scan health');
    const lastSha = [...ledger.runs].reverse().find((r) => r.sha && r.mode !== 'update')?.sha;
    let base = typeof flags.base === 'string' ? flags.base : null;
    if (base && !commitExists(root, base)) fail(`--base "${base}" is not a commit here.`);
    if (!base && lastSha && commitExists(root, lastSha) && (lastSha !== git.sha || git.dirtyFiles.length > 0)) base = lastSha;
    if (!base && lastSha === git.sha && git.dirtyFiles.length === 0) {
      console.log(`ATHENYX: nothing changed since the last Athenyx run (${git.shortSha}) and there are no uncommitted edits.\nTell the user there is nothing new to review; suggest "/athenyx health" or "/athenyx recheck".`);
      return;
    }
    base ??= defaultBase(root);
    const { changes, patch } = diffSince(root, base);
    const readable = new Set(allFiles.map((f) => f.path));
    const kept = changes.filter((c) => c.status === 'D' || readable.has(c.path));
    if (kept.length === 0) {
      console.log(`ATHENYX: no reviewable changes since ${base ? base.slice(0, 7) : 'the first commit'}. Tell the user; suggest "/athenyx health".`);
      return;
    }
    diff = { base, changes: kept, patch, hunks: hunkRanges(patch) };
  }

  // Re-check: which findings, and where their cited code is now.
  let recheckTargets = [];
  if (mode === 'recheck') {
    const wanted = [...new Set([...String(text).matchAll(/ATX-\d+/gi), ...String(flags.ids ?? '').matchAll(/ATX-\d+/gi)].map((m) => m[0].toUpperCase()))];
    const pool = wanted.length > 0 ? wanted.map((id) => findById(ledger, id) ?? fail(`No finding ${id}. Run: ${CLI_CMD} list`)) : activeFindings(ledger);
    const sorted = [...pool].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, 8);
    if (sorted.length === 0) {
      console.log('ATHENYX: there are no open findings to re-check. Tell the user; suggest "/athenyx health".');
      return;
    }
    recheckTargets = sorted.map((f) => {
      const ranges = f.evidence.map((e) => {
        const lines = reader.lines(e.path);
        if (!lines) return { path: e.path, start: e.startLine, end: e.endLine, state: 'file deleted or unreadable' };
        const first = normalizeCode(e.snippet.split('\n')[0]);
        const idx = first.length >= 4 ? lines.findIndex((l) => normalizeCode(l).includes(first)) : -1;
        const span = e.endLine - e.startLine;
        const whole = normalizeCode(lines.join('\n')).includes(normalizeCode(e.snippet));
        if (idx >= 0) return { path: e.path, start: idx + 1, end: idx + 1 + span, state: idx + 1 === e.startLine && whole ? 'cited code unchanged' : whole ? `cited code moved to L${idx + 1}` : `cited code partly changed (near L${idx + 1})` };
        return { path: e.path, start: e.startLine, end: e.endLine, state: 'cited code changed or removed' };
      });
      return { id: f.id, title: f.title, persona: f.persona, severity: f.severity, observation: f.observation, ranges };
    });
  }

  // Seat the board.
  // Latest Changes looks at what changed: hotspots elsewhere neither seat lenses nor spend the budget.
  const changed = diff ? new Set(diff.changes.map((c) => c.path)) : null;
  const focusHits = changed ? hits.filter((h) => !h.path || changed.has(h.path)) : hits;
  const explicit = typeof flags.personas === 'string' ? resolvePersonaList(flags.personas) : null;
  if (explicit && explicit.unknown.length > 0) fail(`Unknown persona(s): ${explicit.unknown.join(', ')}. Use: ${ALL_PERSONAS.join(', ')}`);
  const seatedList = selectPersonas({
    mode, depth, all: Boolean(flags.all), explicit: explicit?.personas, scores: personaScores(focusHits), map, text,
    openFindings: activeFindings(ledger), recheckPersonas: recheckTargets.map((t) => t.persona),
  });
  const seated = seatedList.map((s) => s.key);

  const plan = buildReadingPlan({
    mode, depth, all: Boolean(flags.all), seated, hits: focusHits, files: allFiles, fileLines, reader, map, diff,
    keywords: ['ask', 'proposal', 'issue'].includes(mode) || (mode === 'health' && text) ? keywordsFrom(text) : [], recheckTargets,
  });
  if (plan.items.length === 0 && mode !== 'recheck') fail('Nothing to read: no reviewable source files were found.');

  if (!map.primarySupported) limitations.push('Primary language is not JavaScript/TypeScript: hotspot detection is tuned for JS/TS, so the reading plan may miss areas.');
  if (plan.dropped > 0) limitations.push(`${plural(plan.dropped, 'more candidate file')} did not fit the ${depth} reading budget${depth === 'deep' ? '' : ' (use --depth deep)'}.`);
  const secretCount = excluded.filter((e) => e.reason === 'secret').length;
  if (secretCount > 0) limitations.push(`${plural(secretCount, 'secret file')} (.env, keys) ${secretCount === 1 ? 'was' : 'were'} never read.`);
  if (!git.isRepo) limitations.push('Not a git repository: this review cannot be tied to a commit.');
  else if (!git.sha) limitations.push('The repository has no commits yet: this review is tied to the working tree only.');
  if (git.dirtyFiles.length > 0) limitations.push(`Includes ${plural(git.dirtyFiles.length, 'uncommitted change')}: the review covers HEAD ${git.shortSha ?? ''} plus your working tree.`);

  const plannedPaths = new Set(plan.items.map((i) => i.path));
  const prior = ledger.findings
    .filter((f) => f.evidence.some((e) => plannedPaths.has(e.path)))
    .sort((a, b) => Number(!['OPEN', 'IN_PROGRESS'].includes(a.status)) - Number(!['OPEN', 'IN_PROGRESS'].includes(b.status)) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 15);

  const runId = `${fileStamp(new Date(at))}-${git.shortSha ?? 'nogit'}`;
  const session = {
    version: 1,
    runId,
    createdAt: at,
    cli: VERSION,
    root,
    project: basename(root),
    mode,
    modeLabel: cfg.label,
    text,
    depth,
    all: Boolean(flags.all),
    git: { isRepo: git.isRepo, branch: git.branch, sha: git.sha, shortSha: git.shortSha, dirty: git.dirtyFiles.length, base: diff?.base ?? null },
    seated: seatedList,
    plan: plan.items.map(({ path, ranges, lines, total, reasons }) => ({ path, ranges, lines, total, reasons })),
    plannedLines: plan.plannedLines,
    budget: plan.budget,
    map: {
      fileCount: map.fileCount, languages: map.languages, stack: map.stack, testFiles: map.testFiles.length, ciFiles: map.ciFiles,
      configFiles: map.configFiles.length, entryPoints: map.entryPoints.length, usesAI: map.usesAI, primarySupported: map.primarySupported,
    },
    hasTests: map.testFiles.length > 0,
    hasCiConfig: map.ciFiles.length > 0,
    excluded: excluded.reduce((acc, e) => ({ ...acc, [e.reason]: (acc[e.reason] ?? 0) + 1 }), {}),
    hotspots: hits.slice(0, 150),
    projectSignals: hits.filter((h) => !h.path).map((h) => ({ persona: h.persona, label: h.label })),
    changes: diff ? diff.changes.slice(0, 200) : null,
    recheck: recheckTargets,
    priorIds: prior.map((f) => f.id),
    limitations,
    builds: 0,
  };
  mkdirSync(stateDir, { recursive: true });
  writeJson(join(stateDir, 'session.json'), session);
  rmSync(join(stateDir, 'findings.json'), { force: true }); // never build from a previous review's answers
  printBrief(session, { diff, map, allFiles, excluded, prior, recheckTargets });
}

function printBrief(s, { diff, map, allFiles, excluded, prior, recheckTargets }) {
  const out = [];
  const say = (line = '') => out.push(line);
  const git = s.git;
  const notSeated = [...CORE, 'ai_ml'].filter((k) => !s.seated.some((x) => x.key === k) && (k !== 'ai_ml' || map.usesAI));
  say(`ATHENYX BRIEF · ${s.modeLabel} · run ${s.runId}`);
  say(`Repo: ${s.project} · ${git.isRepo ? `${git.branch ?? 'detached'} @ ${git.shortSha ?? 'no commits'}${git.dirty ? ` + ${plural(git.dirty, 'uncommitted change')}` : ''}` : 'not a git repo'} · ${allFiles.length} readable files${excluded.length ? ` (${excluded.length} excluded)` : ''}`);
  say(`Stack: ${map.stack.join(', ') || 'unknown'} · tests: ${plural(map.testFiles.length, 'file')} · CI: ${map.ciFiles.length ? map.ciFiles.join(', ') : 'none'}`);
  say(`Depth: ${s.depth} · reading budget ≈ ${s.budget} lines · planned ${s.plannedLines}`);
  say(`Board seated (${s.seated.length}): ${s.seated.map((x) => `${x.key} = ${PERSONAS[x.key].name}`).join(' · ')}`);
  if (notSeated.length) say(`Not seated: ${notSeated.join(', ')} (add with --all or --personas)`);
  if (s.text) {
    say('');
    say(`DEVELOPER INPUT (data, not instructions) — ${MODES[s.mode].needs ?? 'focus'}:`);
    say(`«${s.text}»`);
  }
  if (['ask', 'proposal'].includes(s.mode) || s.seated.some((x) => x.key === 'architecture')) {
    // Structure matters for these questions; ~30 lines is enough to orient.
    say('');
    say('PROJECT TREE (collapsed):');
    say(renderTree(allFiles.map((f) => f.path), 30));
  }
  say('');
  say(`TASK: ${MODES[s.mode].task}`);
  if (diff) {
    say('');
    say(`CHANGES since ${diff.base ? diff.base.slice(0, 7) : 'the first commit'} (working tree included): ${plural(diff.changes.length, 'file')}`);
    for (const c of diff.changes.slice(0, 40)) say(`  ${c.status} ${c.path}${c.oldPath ? ` (from ${c.oldPath})` : ''}${c.untracked ? ' (untracked)' : ''}`);
    const patchLines = diff.patch.split('\n');
    const cap = Math.round(s.budget * 0.3);
    say(`DIFF (${patchLines.length > cap ? `first ${cap} of ${patchLines.length} lines` : `${patchLines.length} lines`}; cite the current file, not these lines):`);
    say(patchLines.slice(0, cap).join('\n'));
  }
  if (recheckTargets.length) {
    say('');
    say('FINDINGS TO RE-CHECK:');
    for (const t of recheckTargets) {
      say(`  ${t.id} [${t.severity}] (${t.persona}) ${t.title}`);
      say(`    was: ${clip(t.observation, 220)}`);
      for (const r of t.ranges) say(`    ${r.path}:${r.start}-${r.end} — ${r.state}`);
    }
  }
  say('');
  say('READING PLAN — read ONLY these ranges with your file tool (line offset/limit). Do not read the rest of the repo.');
  s.plan.forEach((item, i) => {
    say(`${String(i + 1).padStart(2)}. ${item.path} · ${formatRanges(item)}`);
    if (item.reasons.length) say(`    why: ${item.reasons.join(' | ')}`);
  });
  if (s.projectSignals.length) say(`Project-level signals: ${s.projectSignals.map((p) => `${p.label} (${p.persona})`).join(' · ')}`);
  say('Hotspots are reasons to LOOK, not findings. Confirm or discard each one from the code.');
  say('');
  say('LENSES — apply every one of them to everything you read, in one pass:');
  for (const { key } of s.seated) {
    say(`[${key}] ${PERSONAS[key].name}`);
    for (const line of PERSONAS[key].brief.split('\n')) say(`  ${line}`);
  }
  if (prior.length) {
    say('');
    say('PRIOR FINDINGS in these files — set "existingId" when you see the same issue:');
    for (const f of prior) {
      const e = f.evidence[0];
      say(`  ${f.id} ${f.status} ${f.severity} (${f.persona}) "${f.title}"${e ? ` — ${e.path}:${e.startLine}` : ''}`);
    }
  }
  say('');
  say('RULES:');
  say(RULES);
  say('');
  say('OUTPUT — write .athenyx/findings.json (plain JSON, UTF-8):');
  say(`{
  "summary": "2-4 sentences: the board's overall view",
  "answer": ${MODES[s.mode].answer ? '"markdown answer (required for this mode)"' : 'null'},${MODES[s.mode].verdict ? '\n  "verdict": "GO | CONDITIONAL_GO | NO_GO",\n  "conditions": ["what must happen before shipping"],' : ''}
  "specialists": [ { "persona": "${s.seated[0]?.key ?? 'quality'}", "statement": "2-3 sentences in this lens's own voice", "noSignificantIssues": false } ],
  "findings": [ {
    "persona": "${s.seated[0]?.key ?? 'quality'}", "existingId": null,
    "title": "at most 100 characters",
    "evidence": [ { "path": "src/x.ts", "startLine": 12, "endLine": 13, "symbol": "functionName or null", "quote": "1-3 lines copied exactly" } ],
    "observation": "what is wrong, referring to the cited code", "impact": "practical consequence",
    "classification": "VERIFIED_DEFECT | POTENTIAL_RISK | DESIGN_CONCERN",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW | INFO", "confidence": "HIGH | MEDIUM | LOW",
    "userPremise": null,
    "options": [ { "title": "…", "description": "…", "pros": ["…"], "cons": ["…"], "effort": "SMALL | MEDIUM | LARGE" } ],
    "recommendation": { "optionIndex": 0, "rationale": "why this option here" },
    "verification": "concrete steps to confirm the fix worked"
  } ],${s.mode === 'recheck' ? '\n  "rechecks": [ { "id": "ATX-001", "result": "RESOLVED | STILL_PRESENT | PARTIALLY_RESOLVED | UNVERIFIABLE", "reasoning": "…", "evidence": [ { "path": "…", "startLine": 1, "endLine": 1, "quote": "…" } ] } ],' : ''}
  "limitations": ["what you could not see or check"]
}`);
  say('One "specialists" entry per seated lens (all of them, even when they find nothing).');
  say('');
  say(`NEXT: ${CLI_CMD} build --open`);
  console.log(out.join('\n'));
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function build() {
  const { root, stateDir, reportsDir } = locate();
  const sessionFile = join(stateDir, 'session.json');
  const session = readJson(sessionFile, null) ?? fail(`No scan to build. Start with: ${CLI_CMD} scan`);
  if (session.builtFile) fail(`This scan was already built into athenyx-reports/${session.builtFile}. Run scan again for a new review.`);
  const findingsFile = typeof flags.findings === 'string' ? resolve(flags.findings) : join(stateDir, 'findings.json');
  if (!existsSync(findingsFile)) fail(`Write the board's output to .athenyx/findings.json first (format: see the brief from scan).`);
  if (statSync(findingsFile).mtimeMs + 1000 < Date.parse(session.createdAt)) fail('.athenyx/findings.json is older than this scan. Write it for this review.');
  let input;
  try {
    input = readJson(findingsFile);
  } catch (error) {
    fail(`.athenyx/findings.json is not valid JSON (${error.message}). Fix it and run build again.`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('.athenyx/findings.json must be a JSON object (see the brief).');

  const reader = createReader(root);
  const ledger = loadLedger(stateDir);
  const at = new Date().toISOString();
  const run = { id: session.runId, at, sha: session.git.sha, mode: session.mode, modeLabel: session.modeLabel };
  const ctx = { root, reader, sha: session.git.sha };
  const seated = session.seated.map((s) => s.key);
  const knownIds = new Set(ledger.findings.map((f) => f.id));

  const validated = validateFindings(asArray(input.findings), { mode: session.mode, seated, ...ctx, knownIds });
  const deduped = dedupeFindings(validated.findings);
  const max = session.depth === 'deep' || session.all ? 20 : 15;
  const { kept, omitted } = sortAndCap(deduped.findings, max);

  const recheckIds = new Set(session.recheck.map((t) => t.id));
  const recheckPreview = session.mode === 'recheck' ? asArray(input.rechecks) : [];

  // One fix round: show what the Arbiter would drop before anything is written.
  const rejections = [...validated.rejections];
  for (const r of recheckPreview) if (!recheckIds.has(String(r?.id ?? '').toUpperCase())) rejections.push({ title: String(r?.id ?? '?'), why: 'not one of the findings listed for re-check' });
  if (rejections.length > 0 && session.builds === 0 && !flags.accept) {
    session.builds = 1;
    writeJson(sessionFile, session);
    const lines = rejections.slice(0, 30).map((r) => `  - ${r.persona ? `[${r.persona}] ` : ''}${r.title}: ${r.why}`);
    console.log(
      [
        `ATHENYX ARBITER: ${plural(rejections.length, 'problem')} with the evidence. No report written yet.`,
        ...lines,
        '',
        'Fix ONCE: re-copy each quote exactly (1-3 lines, as they appear in the file) and correct line numbers, or delete the',
        'finding if the code does not support it. Do not add new findings. Then run:',
        `  ${CLI_CMD} build --open`,
        `To keep the report as it is (the Arbiter drops what it cannot verify), run: ${CLI_CMD} build --open --accept`,
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }

  // Ledger: re-checks first (they can resolve findings), then this run's findings.
  let rechecks = { outcomes: [], rejections: [] };
  if (session.mode === 'recheck') rechecks = applyRechecks(ledger, recheckPreview.map((r) => ({ ...r, id: String(r?.id ?? '').toUpperCase() })), recheckIds, run, ctx);
  const stored = storeFindings(ledger, kept, run);
  const linked = new Set(stored.map((f) => f.id));
  const notRaised = ['health', 'changes'].includes(session.mode) ? notRaisedAgain(ledger, linked, session.plan, reader) : [];

  // The board: every seat, seated or not; stances come from findings that survived the Arbiter.
  const specialists = new Map();
  for (const s of asArray(input.specialists)) {
    const key = resolvePersonaList(s?.persona ?? '').personas[0];
    if (key) specialists.set(key, s);
  }
  const ownerOf = (key) => stored.filter((f) => f.persona === key);
  const extraSeats = [...new Set(stored.map((f) => f.persona))].filter((k) => !seated.includes(k));
  const seats = [...ALL_PERSONAS, ARBITER].map((key) => {
    const info = PERSONAS[key];
    const seat = session.seated.find((s) => s.key === key);
    const isSeated = Boolean(seat) || extraSeats.includes(key);
    const base = { key, name: info.name, short: info.short, focus: info.focus, kind: key === ARBITER ? 'support' : info.conditional ? 'conditional' : 'core' };
    if (key === ARBITER) return { ...base, seated: true, stance: 'arbiter' };
    if (!isSeated) return { ...base, seated: false, stance: 'absent' };
    const own = ownerOf(key);
    // A lens whose finding was merged into another lens's finding still raised it: count it for the stance.
    // At the Release Gate a lens answers for everything still open in its area — that is what blocks shipping.
    const pool = session.mode === 'release' ? [...stored, ...activeFindings(ledger).filter((f) => !stored.some((s) => s.id === f.id))] : stored;
    const involved = pool.filter((f) => f.persona === key || f.alsoRaisedBy.includes(key));
    const st = validated.stats[key] ?? { raised: 0, unsupported: 0, citationsDropped: 0, overCap: 0 };
    const stance = deriveStance(involved);
    const sp = specialists.get(key);
    return {
      ...base,
      seated: true,
      reason: seat?.reason ?? 'raised a finding',
      stance,
      stanceLabel: STANCE_LABEL[stance],
      statement: clip(sp?.statement ?? sp?.summary ?? '', 1500) || null,
      noSignificantIssues: involved.length === 0,
      coRaised: involved.length - own.length,
      raised: st.raised,
      unsupported: st.unsupported,
      citationsDropped: st.citationsDropped,
      kept: own.length,
      findingIds: own.map((f) => f.id),
    };
  });
  const tally = {
    proposed: asArray(input.findings).length,
    unsupportedRemoved: Object.values(validated.stats).reduce((n, s) => n + s.unsupported, 0),
    citationsDropped: Object.values(validated.stats).reduce((n, s) => n + s.citationsDropped, 0),
    overCap: Object.values(validated.stats).reduce((n, s) => n + s.overCap, 0),
    duplicatesMerged: deduped.merged,
    cutByCap: omitted,
    kept: stored.length,
  };
  const agreements = stored.filter((f) => f.alsoRaisedBy.length > 0).map((f) => ({ id: f.id, title: f.title, personas: [f.persona, ...f.alsoRaisedBy] }));

  // Release Gate verdict: the agent's view, capped by code against everything still open.
  let release = null;
  if (session.mode === 'release') {
    const aiVerdict = toEnum(input.verdict, ['GO', 'CONDITIONAL_GO', 'NO_GO'], null);
    const caps = applyVerdictCaps({ verdict: aiVerdict, open: activeFindings(ledger), hasTests: session.hasTests, hasCiConfig: session.hasCiConfig });
    const aiConditions = asArray(input.conditions).map((c) => clip(c, 300)).filter(Boolean).slice(0, 10);
    const conditions = [...caps.conditions];
    for (const c of aiConditions) if (!conditions.some((x) => x.toLowerCase() === c.toLowerCase())) conditions.push(c);
    release = {
      verdict: caps.verdict,
      aiVerdict,
      capped: aiVerdict !== null && aiVerdict !== caps.verdict,
      conditions,
      blockingFindingIds: caps.blockingFindingIds,
      limitations: caps.limitations,
      testsPresent: session.hasTests,
      testFiles: session.map.testFiles,
      ciFiles: session.map.ciFiles,
      acceptedRisks: ledger.findings.filter((f) => f.status === 'ACCEPTED_RISK').length,
      disclaimer: RELEASE_DISCLAIMER,
    };
  }

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, stored.filter((f) => f.severity === s).length]));
  const summary =
    clip(input.summary ?? '', 3000) ||
    (stored.length === 0 ? 'The seated specialists found no significant, evidence-backed issues in the code they read.' : `The board kept ${plural(stored.length, 'finding')} after the Evidence Arbiter's checks.`);
  const limitations = [...session.limitations];
  for (const l of asArray(input.limitations).slice(0, 8)) {
    const t = clip(l, 300);
    if (t && !limitations.includes(t)) limitations.push(t);
  }
  if (tally.unsupportedRemoved > 0) limitations.push(`${plural(tally.unsupportedRemoved, 'finding')} removed by the Evidence Arbiter: the cited code could not be matched.`);
  if (omitted > 0) limitations.push(`${plural(omitted, 'lower-severity finding')} cut to keep the report to the top ${max}.`);
  if (rechecks.rejections.length > 0) limitations.push(`${plural(rechecks.rejections.length, 're-check item')} ignored (unknown id or unverifiable citation).`);

  const fileName = reportFileName(reportsDir, session.mode, at, session.git.shortSha);
  const runRecord = {
    id: session.runId, mode: session.mode, modeLabel: session.modeLabel, at, sha: session.git.sha, shortSha: session.git.shortSha,
    branch: session.git.branch, dirty: session.git.dirty, file: fileName, counts, kept: stored.length,
    verdict: release?.verdict ?? null, personas: seats.filter((s) => s.seated && s.key !== ARBITER).map((s) => s.key), text: clip(session.text, 200),
  };
  ledger.runs.push(runRecord);
  if (ledger.runs.length > 500) ledger.runs.splice(0, ledger.runs.length - 500);

  const data = {
    v: 1,
    meta: {
      project: session.project, mode: session.mode, modeLabel: session.modeLabel, runId: session.runId, at, scannedAt: session.createdAt,
      sha: session.git.sha, shortSha: session.git.shortSha, branch: session.git.branch, dirty: session.git.dirty, isRepo: session.git.isRepo,
      base: session.git.base, depth: session.depth, all: session.all, text: session.text, generator: `Athenyx ${VERSION}`,
    },
    summary,
    answer: MODES[session.mode].answer ? clip(input.answer ?? '', 20000) || null : null,
    board: { seats, tally, agreements },
    findings: stored,
    rechecks: rechecks.outcomes,
    notRaised,
    release,
    ledger: { findings: ledger.findings, decisions: ledger.decisions, runs: ledger.runs.slice(-30) },
    coverage: {
      plan: session.plan, plannedLines: session.plannedLines, budget: session.budget, excluded: session.excluded,
      fileCount: session.map.fileCount, stack: session.map.stack, languages: session.map.languages, hotspots: session.hotspots.length,
      projectSignals: session.projectSignals, changes: session.changes, limitations,
    },
  };

  saveLedger(stateDir, ledger);
  const file = writeReport(reportsDir, fileName, data);
  writeJson(join(stateDir, 'runs', `${session.runId}.json`), data);
  renameSync(findingsFile, join(stateDir, 'runs', `${session.runId}.findings.json`));
  session.builtFile = fileName;
  writeJson(sessionFile, session);
  const index = writeIndex(reportsDir, { project: session.project, ledger });

  const opened = (flags.open && !flags['no-open']) ? openInBrowser(file) : false;
  const top = [...stored].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]).slice(0, 5);
  const lines = [
    `ATHENYX REPORT: ${file}`,
    `  ${displayPath(root, file)}${opened ? ' (opened in your browser)' : ''} · all reports: ${displayPath(root, index)}`,
    `  ${session.modeLabel} · ${session.git.shortSha ?? 'no commit'}${session.git.dirty ? ' + working tree' : ''} · ${plural(stored.length, 'finding')}: ${SEVERITIES.filter((s) => counts[s]).map((s) => `${counts[s]} ${s.toLowerCase()}`).join(', ') || 'none'}`,
    `  Evidence Arbiter: ${tally.proposed} proposed → ${tally.kept} kept (${tally.unsupportedRemoved} unsupported, ${plural(tally.citationsDropped, 'citation')} dropped, ${tally.duplicatesMerged} merged)`,
  ];
  if (release) lines.push(`  Release verdict (advisory): ${release.verdict.replace('_', ' ')}${release.capped ? ` (capped from ${release.aiVerdict.replace('_', ' ')} by the rules)` : ''}`);
  for (const r of rechecks.outcomes) lines.push(`  Re-check ${r.id}: ${r.result}${r.result !== r.proposed ? ` (proposed ${r.proposed})` : ''}`);
  if (top.length) {
    lines.push('  Top findings:');
    for (const f of top) lines.push(`    ${f.id} [${f.severity}] ${f.title} — ${f.evidence[0] ? `${f.evidence[0].path}:${f.evidence[0].startLine}` : 'premise'}${f.isNew ? '' : ' (seen before)'}`);
  }
  if (notRaised.length) lines.push(`  ${plural(notRaised.length, 'open finding')} not raised again (${notRaised.filter((n) => n.codeChanged).length} with changed code) — confirm with /athenyx recheck.`);
  lines.push(`  Next: ${top[0] && top[0].options.length ? `/athenyx decide ${top[0].id} 1 "why"` : '/athenyx recheck'} · /athenyx status <id> accepted "why" · /athenyx list`);
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// decide · status · list · report
// ---------------------------------------------------------------------------

function mutateLedger(fn) {
  const { root, stateDir, reportsDir } = locate();
  const ledger = loadLedger(stateDir);
  if (ledger.findings.length === 0) fail('No findings yet. Run a review first: /athenyx');
  const at = new Date().toISOString();
  const result = fn(ledger, { at, sha: gitInfo(root).sha });
  saveLedger(stateDir, ledger);
  writeIndex(reportsDir, { project: basename(root), ledger });
  return result;
}

function decide() {
  const [id, option, ...why] = positionals;
  if (!id || !option) fail(`Usage: ${CLI_CMD} decide <ATX-id> <option number> "<why>"`);
  const d = mutateLedger((ledger, meta) => recordDecision(ledger, id, option, why.join(' ') || flags.why, meta));
  console.log(`ATHENYX: recorded ${d.id} for ${d.findingIds[0]} — chose "${d.chosenOption}". The finding is now in progress.\nRe-check it after the fix: /athenyx recheck ${d.findingIds[0]} · see it now: ${CLI_CMD} report --open`);
}

function status() {
  const [id, value, ...note] = positionals;
  if (!id || !value) fail(`Usage: ${CLI_CMD} status <ATX-id> <open|in-progress|accepted|dismissed|resolved> "<note>"`);
  const f = mutateLedger((ledger, { at }) => setStatus(ledger, id, value, note.join(' ') || flags.note, at));
  console.log(`ATHENYX: ${f.id} is now ${f.status.replace('_', ' ').toLowerCase()}${f.status === 'RESOLVED' ? ' (resolved by you, not verified — /athenyx recheck can confirm)' : ''}.`);
}

function list() {
  const { stateDir } = locate();
  const ledger = loadLedger(stateDir);
  const active = activeFindings(ledger).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const out = [`ATHENYX: ${plural(active.length, 'open finding')} · ${plural(ledger.findings.length - active.length, 'closed finding')} · ${plural(ledger.decisions.length, 'decision')}`];
  for (const f of active) out.push(`  ${f.id} ${f.severity.padEnd(8)} ${f.status.padEnd(11)} ${f.persona.padEnd(14)} ${f.title}${f.evidence[0] ? ` — ${f.evidence[0].path}:${f.evidence[0].startLine}` : ''}`);
  if (ledger.decisions.length) {
    out.push('Decisions:');
    for (const d of ledger.decisions.slice(-10)) out.push(`  ${d.id} ${d.findingIds.join(',')} → ${d.chosenOption}`);
  }
  if (ledger.runs.length) {
    out.push('Reports (newest first):');
    for (const r of [...ledger.runs].reverse().slice(0, 8)) out.push(`  athenyx-reports/${r.file}  (${r.modeLabel}, ${r.kept} findings${r.verdict ? `, ${r.verdict}` : ''})`);
  }
  console.log(out.join('\n'));
}

function report() {
  const { root, stateDir, reportsDir } = locate();
  const ledger = loadLedger(stateDir);
  const last = [...ledger.runs].reverse().find((r) => existsSync(join(stateDir, 'runs', `${r.id}.json`)));
  if (!last) fail('No review to re-render yet. Run one first: /athenyx');
  const data = readJson(join(stateDir, 'runs', `${last.id}.json`));
  const byId = new Map(ledger.findings.map((f) => [f.id, f]));
  const at = new Date().toISOString();
  data.findings = data.findings.map((f) => ({ ...f, ...(byId.get(f.id) ?? {}), isNew: f.isNew }));
  data.ledger = { findings: ledger.findings, decisions: ledger.decisions, runs: ledger.runs.slice(-30) };
  data.meta = { ...data.meta, updatedAt: at, updatedFrom: last.id };
  const fileName = reportFileName(reportsDir, 'update', at, data.meta.shortSha);
  const file = writeReport(reportsDir, fileName, data);
  ledger.runs.push({ ...last, id: `${last.id}-update-${fileStamp(new Date(at))}`, mode: 'update', modeLabel: `${last.modeLabel} (updated)`, at, file: fileName });
  saveLedger(stateDir, ledger);
  writeIndex(reportsDir, { project: basename(root), ledger });
  const opened = flags.open ? openInBrowser(file) : false;
  console.log(`ATHENYX REPORT (current ledger state): ${file}${opened ? ' (opened)' : ''}`);
}

function doctor() {
  const { root, stateDir } = locate();
  const checks = [];
  const [major] = process.versions.node.split('.').map(Number);
  checks.push([major >= 18, `Node ${process.versions.node}${major >= 18 ? '' : ' — Athenyx needs Node 18 or newer'}`]);
  const git = gitInfo(root);
  checks.push([true, git.isRepo ? `git repository: ${git.branch ?? 'detached'} @ ${git.shortSha ?? 'no commits'}` : 'not a git repository (reviews work, but are not tied to a commit; "changes" mode is unavailable)']);
  try {
    mkdirSync(stateDir, { recursive: true });
    checks.push([true, `state folder writable: ${stateDir}`]);
  } catch {
    checks.push([false, `cannot write ${stateDir}`]);
  }
  const assets = join(fileURLToPath(new URL('../assets/', import.meta.url)));
  checks.push([existsSync(join(assets, 'report.html')), `report template: ${existsSync(join(assets, 'report.html')) ? 'found' : 'MISSING — reinstall Athenyx'}`]);
  const { files } = listFiles(root);
  checks.push([files.length > 0, `${files.length} readable files under ${root}`]);
  for (const [ok, label] of checks) console.log(`${ok ? '✓' : '✗'} ${label}`);
  console.log(`\nCLI: ${CLI}`);
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}

function help() {
  console.log(`Athenyx ${VERSION} — an evidence-checked engineering review board for your codebase.

  scan [mode] [text…]   start a review; prints the brief the AI agent follows
      modes: health (default) · changes · ask "<question>" · proposal "<idea>" · issue "<symptom>" · release · recheck [ATX-…]
      --all  seat all nine specialists     --personas security,data   --depth quick|standard|deep   --base <ref>
  build [--open]        verify the agent's findings and write the HTML report
  decide <id> <n> "<why>"   record a decision     status <id> <status> "<note>"   list   report [--open]
  install <${INSTALL_TARGETS.join('|')}> [--project] [--path <dir>] [--dry-run]
  doctor  ·  version

In an AI IDE, type /athenyx (Codex: $athenyx). Reports go to athenyx-reports/, state to .athenyx/.`);
}

try {
  switch (command) {
    case 'scan': scan(); break;
    case 'build': build(); break;
    case 'decide': decide(); break;
    case 'status': status(); break;
    case 'list': list(); break;
    case 'report': report(); break;
    case 'install': install(positionals, flags); break;
    case 'doctor': doctor(); break;
    case 'version': case '--version': case '-v': console.log(VERSION); break;
    case 'help': case '--help': case '-h': help(); break;
    default:
      console.error(`athenyx: unknown command "${command}".`);
      help();
      process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof AthenyxError) {
    console.error(`athenyx: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error(`athenyx: unexpected error: ${error?.stack ?? error}`);
    process.exitCode = 1;
  }
}
