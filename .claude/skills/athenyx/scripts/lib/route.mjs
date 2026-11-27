// Persona routing and the reading plan. Deterministic: no AI is spent deciding what to read.
import { isTestPath } from './files.mjs';
import { isCodePath } from './map.mjs';
import { ALL_PERSONAS, CORE, MODES, PERSONAS, TOPIC_WORDS, mentionsAi } from './personas.mjs';
import { selectReleasePersonas } from './release.mjs';

export const DEPTHS = {
  quick: { maxPersonas: 3, budget: 900 },
  standard: { maxPersonas: 5, budget: 2200 },
  deep: { maxPersonas: 10, budget: 4500 },
};

const UI_STACK = ['nextjs', 'react', 'vue', 'nuxt', 'svelte', 'sveltekit', 'angular', 'astro', 'remix', 'react-native', 'expo', 'electron'];
const DATA_STACK = ['prisma', 'drizzle', 'mongoose', 'typeorm', 'sequelize', 'knex', 'postgres', 'mysql', 'redis', 'sqlalchemy', 'django', 'supabase', 'firebase'];

/**
 * Chooses the seated lenses. Returns [{ key, reason }] in seat order.
 * - explicit list wins; --all seats the nine (+ AI/ML when the project or request involves AI)
 * - release: DevOps + Quality, + Security for auth/payment stacks or open serious security findings
 * - otherwise: scored by hotspots, mode baseline, the developer's words and stack signals
 */
export function selectPersonas({ mode, depth, explicit, all, scores, map, text, openFindings, recheckPersonas }) {
  const allowAi = map.usesAI || mentionsAi(text);
  if (mode === 'recheck') return [...new Set(recheckPersonas)].map((key) => ({ key, reason: 'raised a finding being re-checked' }));
  if (explicit && explicit.length > 0) return explicit.map((key) => ({ key, reason: 'chosen by you' }));
  if (all) {
    const keys = [...CORE, ...(allowAi ? ['ai_ml'] : [])];
    return keys.map((key) => ({ key, reason: 'full board (--all)' }));
  }
  if (mode === 'release') {
    const keys = selectReleasePersonas(map, openFindings, 3);
    if (depth === 'deep') keys.push(...['reliability', 'data_integrity'].filter((k) => !keys.includes(k)));
    return keys.map((key) => ({ key, reason: 'release gate seat' }));
  }

  const why = {};
  const score = {};
  const add = (key, n, reason) => {
    score[key] = (score[key] ?? 0) + n;
    (why[key] ??= []).push(reason);
  };
  for (const key of ALL_PERSONAS) {
    if (scores[key]) add(key, scores[key], `${scores[key]} hotspot point${scores[key] === 1 ? '' : 's'}`);
  }
  for (const key of MODES[mode].baseline) add(key, 2, `${MODES[mode].label} default seat`);
  for (const [key, re] of Object.entries(TOPIC_WORDS)) if (text && re.test(text)) add(key, 5, 'your request mentions it');
  if (map.stack.some((s) => UI_STACK.includes(s))) add('product_ux', 1, 'UI framework');
  if (map.stack.some((s) => DATA_STACK.includes(s)) || map.migrations.length > 0) add('data_integrity', 1.5, 'database in the stack');
  if (map.ciFiles.length > 0 || map.configFiles.some((p) => /Dockerfile|compose/.test(p))) add('devops', 0.5, 'CI / container config');
  if (map.fileCount > 150) {
    add('architecture', 2, 'large codebase');
    add('code_quality', 1, 'large codebase');
  }
  if (allowAi) add('ai_ml', 3, 'the project or request involves AI');
  else delete score.ai_ml;

  const cfg = DEPTHS[depth];
  const ranked = ALL_PERSONAS.filter((k) => (k !== 'ai_ml' || allowAi) && score[k] > 0).sort(
    (a, b) => score[b] - score[a] || ALL_PERSONAS.indexOf(a) - ALL_PERSONAS.indexOf(b),
  );
  let chosen;
  if (depth === 'deep') chosen = [...CORE, ...(allowAi ? ['ai_ml'] : [])];
  else {
    // Seat every lens with a real signal, at least 3, at most the depth cap.
    const strong = ranked.filter((k) => score[k] >= 2);
    chosen = (strong.length >= 3 ? strong : ranked).slice(0, cfg.maxPersonas);
    for (const k of MODES[mode].baseline) if (chosen.length < 3 && !chosen.includes(k)) chosen.push(k);
  }
  return chosen.map((key) => ({ key, reason: (why[key] ?? ['full board (deep)']).slice(0, 3).join(', ') }));
}

const STOP = new Set(
  'about above after again against also because before being below between both could does doing during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very what when where which while with would your yours code file files function functions does work works working make sure thing things please there project codebase app application using used want need like'.split(' '),
);

/** Search words from the developer's text: identifiers first, then distinctive words. Literal, never regex. */
export function keywordsFrom(text, max = 8) {
  const out = [];
  const add = (w) => {
    const k = w.toLowerCase();
    if (k.length >= 3 && !STOP.has(k) && !out.includes(k)) out.push(k);
  };
  for (const m of String(text ?? '').matchAll(/`([^`]{3,60})`|\b([A-Za-z_$][\w$]*[a-z][A-Z_][\w$]*|[a-z]+_[a-z_]+)\b/g)) add(m[1] ?? m[2]);
  for (const m of String(text ?? '').matchAll(/\b[A-Za-z]{5,}\b/g)) add(m[0]);
  return out.slice(0, max);
}

/**
 * Builds the reading plan within a line budget.
 * Returns { items: [{ path, ranges: [[s, e]], lines, total, reasons }], plannedLines, budget, dropped }.
 */
export function buildReadingPlan({ mode, depth, all, seated, hits, files, fileLines, reader, map, diff, keywords, recheckTargets }) {
  const budget = Math.round(DEPTHS[depth].budget * (all && depth !== 'deep' ? 1.35 : 1));
  const readable = new Set(files.map((f) => f.path));
  const seatedSet = new Set(seated);
  const cand = new Map(); // path -> { ranges: [{s, e}], priority, reasons: [] }
  const totalOf = (p) => fileLines.get(p) ?? reader.lines(p)?.length ?? 0;
  const want = (path, s, e, priority, reason) => {
    if (!readable.has(path)) return;
    const total = totalOf(path);
    if (total === 0) return;
    const c = cand.get(path) ?? { ranges: [], priority: 0, reasons: [] };
    c.ranges.push([Math.max(1, s), Math.min(total, e)]);
    c.priority = Math.max(c.priority, priority);
    if (reason && !c.reasons.includes(reason) && c.reasons.length < 6) c.reasons.push(reason);
    cand.set(path, c);
  };
  const whole = (path, priority, reason, cap = 400) => want(path, 1, Math.min(totalOf(path), cap), priority, reason);

  if (mode === 'changes' && diff) {
    for (const change of diff.changes) {
      if (change.status === 'D') continue;
      const ranges = diff.hunks[change.path];
      if (ranges && ranges.length > 0) for (const [s, e] of ranges) want(change.path, s - 12, e + 12, 100, `changed (${change.status})`);
      else whole(change.path, 95, change.untracked ? 'new file' : `changed (${change.status})`, 250);
    }
    // Callers of changed modules: where a changed signature or behaviour turns into a regression.
    const changedCode = diff.changes.filter((c) => isCodePath(c.path) && !isTestPath(c.path));
    for (const change of changedCode.slice(0, 15)) {
      const stem = change.path.replace(/\.[^./]+$/, '').split('/').pop();
      if (!stem || stem === 'index') continue;
      const importRe = new RegExp(String.raw`(from\s+|require\(\s*|import\s*\(\s*)['"][^'"]*[/.]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\.[a-z]+)?['"]`);
      let n = 0;
      for (const f of files) {
        if (n >= 6 || f.path === change.path || !isCodePath(f.path)) continue;
        const lines = reader.lines(f.path);
        const at = lines ? lines.findIndex((l) => importRe.test(l)) : -1;
        if (at < 0) continue;
        n += 1;
        want(f.path, at + 1 - 2, at + 1 + 45, 80, `imports changed ${stem} (L${at + 1})`);
      }
    }
  }
  if (mode === 'recheck') {
    for (const t of recheckTargets) for (const r of t.ranges) want(r.path, r.start - 15, r.end + 15, 100, `re-check ${t.id}`);
  }
  if (mode === 'release') {
    for (const p of map.ciFiles) whole(p, 70, 'CI configuration', 150);
    for (const p of map.configFiles.filter((p) => !/tsconfig|eslint/.test(p))) whole(p, 60, 'configuration', 150);
    for (const p of map.migrations.filter((p) => /\.(sql|ts|js|py)$/.test(p)).slice(-5)) whole(p, 55, 'recent migration', 120);
    for (const p of map.entryPoints.slice(0, 8)) want(p, 1, 60, 40, 'entry point');
  }

  // Hotspot windows for seated lenses.
  for (const h of hits) {
    if (!h.path || !seatedSet.has(h.persona)) continue;
    want(h.path, h.line - 12, h.line + 20, 20 + h.weight * 10, `${PERSONAS[h.persona].short}: ${h.label} (L${h.line})`);
  }

  // The developer's own words: files whose path or content mention them.
  if (keywords.length > 0) {
    const pool = files.filter((f) => isCodePath(f.path) || /\.(md|ya?ml|json|prisma|sql)$/.test(f.path)).slice(0, 4000);
    for (const kw of keywords) {
      let n = 0;
      for (const f of pool.filter((x) => x.path.toLowerCase().includes(kw))) {
        if (n >= 2) break;
        n += 1;
        want(f.path, 1, 120, 52, `path matches "${kw}"`);
      }
      const matches = [];
      for (const f of pool) {
        if (matches.length >= 6) break;
        const lines = reader.lines(f.path);
        if (!lines) continue;
        const idx = lines.findIndex((l) => l.toLowerCase().includes(kw));
        if (idx >= 0) matches.push({ path: f.path, idx, test: isTestPath(f.path) });
      }
      matches.sort((a, b) => Number(a.test) - Number(b.test));
      for (const m of matches.slice(0, 3)) want(m.path, m.idx + 1 - 15, m.idx + 1 + 25, 48, `mentions "${kw}" (L${m.idx + 1})`);
    }
  }

  // Baseline context.
  if (mode !== 'recheck') {
    const rootManifest = map.manifests.find((m) => !m.path.includes('/'))?.path ?? map.manifests[0]?.path;
    if (rootManifest) whole(rootManifest, 30, 'manifest (dependencies, scripts)', 90);
    const schema = map.configFiles.find((p) => /schema\.prisma$/.test(p));
    if (schema && seatedSet.has('data_integrity')) whole(schema, 45, 'database schema', 260);
    if (seatedSet.has('devops')) {
      for (const p of map.ciFiles.slice(0, 2)) whole(p, 35, 'CI configuration', 120);
      const tpl = files.find((f) => /(^|\/)\.env\.(example|sample|template)$/.test(f.path));
      if (tpl) whole(tpl.path, 33, 'documented environment', 80);
    }
    if (seatedSet.has('quality')) {
      for (const t of map.testFiles.slice(0, 2)) want(t, 1, 60, 15, 'existing tests (style and coverage)');
    }
  }

  const finalize = () => {
    const items = [];
    for (const [path, c] of cand) {
      const total = totalOf(path);
      const ranges = c.ranges.sort((a, b) => a[0] - b[0]).reduce((acc, r) => {
        const last = acc[acc.length - 1];
        if (last && r[0] <= last[1] + 8) last[1] = Math.max(last[1], r[1]);
        else acc.push([...r]);
        return acc;
      }, []);
      const covered = ranges.reduce((n, [s, e]) => n + e - s + 1, 0);
      // Small or mostly-covered files are cheaper to read whole than in fragments.
      const merged = total <= 150 || covered >= total * 0.7 ? [[1, total]] : ranges;
      items.push({ path, ranges: merged, total, priority: c.priority, reasons: c.reasons, lines: merged.reduce((n, [s, e]) => n + e - s + 1, 0) });
    }
    return items.sort((a, b) => b.priority - a.priority || a.lines - b.lines);
  };

  // Small repos / few hotspots: fill with the core modules so the board isn't reviewing blind.
  let items = finalize();
  const planned = items.reduce((n, i) => n + i.lines, 0);
  if (planned < budget * 0.5 && mode !== 'recheck' && mode !== 'changes') {
    const used = new Set(items.map((i) => i.path));
    const hitCount = new Map();
    for (const h of hits) if (h.path) hitCount.set(h.path, (hitCount.get(h.path) ?? 0) + h.weight);
    const extra = files
      .filter((f) => isCodePath(f.path) && !isTestPath(f.path) && !used.has(f.path) && !/\.(d\.ts|config\.\w+)$/.test(f.path))
      .sort((a, b) => (hitCount.get(b.path) ?? 0) - (hitCount.get(a.path) ?? 0) || Number(map.entryPoints.includes(b.path)) - Number(map.entryPoints.includes(a.path)) || a.size - b.size);
    let room = budget * 0.85 - planned;
    for (const f of extra) {
      if (room <= 40) break;
      const total = totalOf(f.path);
      const take = Math.min(total, 150);
      if (take === 0) continue;
      want(f.path, 1, take, 5, map.entryPoints.includes(f.path) ? 'entry point' : 'core module');
      room -= take;
    }
    items = finalize();
  }

  // Apply the budget: highest priority first; the last file may be cut short.
  const kept = [];
  let used = 0;
  let dropped = 0;
  for (const item of items) {
    if (used >= budget) {
      dropped += 1;
      continue;
    }
    const room = budget - used;
    if (item.lines <= room) {
      kept.push(item);
      used += item.lines;
    } else if (room >= 30) {
      const ranges = [];
      let left = room;
      for (const [s, e] of item.ranges) {
        if (left <= 0) break;
        const end = Math.min(e, s + left - 1);
        ranges.push([s, end]);
        left -= end - s + 1;
      }
      kept.push({ ...item, ranges, lines: room, cut: true });
      used = budget;
    } else dropped += 1;
  }
  return { items: kept, plannedLines: used, budget, dropped };
}

export const formatRanges = (item) => item.ranges.map(([s, e]) => (s === 1 && e === item.total ? `whole file (${item.total} lines)` : `${s}-${e}`)).join(', ');
