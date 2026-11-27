// Deterministic hotspot scan: cheap pattern checks that point each lens at the
// lines worth reading. A hotspot is a reason to LOOK, never a finding by itself.
import { basename } from 'node:path';
import { isTestPath } from './files.mjs';
import { isCodePath } from './map.mjs';

const MONEY = /\b(amount|price|total|balance|cost|fee|cents?|currency|payment|charge|invoice|split|share|refund|payout|salary|tax|subtotal|wallet)\w*/i;
const TIMEOUT_MARKERS = /\b(signal|timeout|AbortController|AbortSignal|timeoutMs|deadline)\b/;
const PAYMENT_WORDS = /\b(payment|charge|stripe|paypal|invoice|payout|refund|transfer|checkout)\w*/i;
const IDEMPOTENCY = /idempoten/i;
const PENDING_MARKERS = /\b(disabled|isPending|pending|isSubmitting|submitting|loading|isLoading|useFormStatus|useTransition|aria-busy)\b/;
const AUTH_MARKERS = /\b(get(Server)?Session\w*|getCurrentUser|currentUser|getUser|requireUser|requireAuth|requireSession|withAuth|verifyToken|isAuthenticated|login_required|authenticate\w*|useSession)\b|\bauth\(\)|req\.user|request\.user|session\.user/;
const OWNER_MARKERS = /\b(userId|ownerId|authorId|user_id|owner_id|owner|members?|groupId|teamId|orgId|organizationId|tenantId|accountId|createdBy)\b|session\.user|req\.user|request\.user/;
const BY_ID_ACCESS = /\.(findUnique|findFirst|findOne|update|delete|upsert|findById|findByIdAndUpdate|findByIdAndDelete|deleteOne|updateOne|get_object_or_404|get)\s*\(/;
const LOOP = /\bfor\s*\(|\bwhile\s*\(|\.(forEach|map|flatMap|reduce)\s*\(|^\s*for\s+\w+(\s*,\s*\w+)?\s+in\s+|\bfor\s+(const|let|var)\s+\w+\s+of\b/;
const ROUTE_FILE = /(^|\/)(app\/(.+\/)?route\.(t|j)sx?|pages\/api\/.+\.(t|j)sx?|api\/.+\.(t|j)s|routes?\/.+\.(t|j)s|controllers?\/.+\.(t|j)s|[^/]+\.controller\.(t|j)s|views\.py|handlers?\/.+\.(t|j)s|server\/.+\.(t|j)s)$/;
const SECRET_ASSIGNMENT = /[A-Za-z0-9_]*(?:password|passwd|secret|api[_-]?key|token)[A-Za-z0-9_]*["']?\s*[:=]\s*(["'])[^"'\s]{8,}\1/i;
const PLACEHOLDER_VALUE = /(example|changeme|placeholder|your[_-]|xxx|dummy|test|sample|<|\$\{|process\.env)/i;

/** Line rules: { id, persona, label, weight, re, when?(line, ctx) }. */
const LINE_RULES = [
  // security
  { id: 'raw-html', persona: 'security', weight: 2, label: 'Raw HTML injection point', re: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=|\|\s*safe\b|mark_safe\(/ },
  { id: 'eval', persona: 'security', weight: 3, label: 'Dynamic code evaluation', re: /\beval\s*\(|new Function\s*\(/ },
  { id: 'exec', persona: 'security', weight: 2, label: 'Shell command execution', re: /\bchild_process\b|\bexecSync\s*\(|\bexec\s*\(\s*[`'"]|subprocess\.(run|call|Popen)\(|os\.system\(/ },
  { id: 'sql-interp', persona: 'security', weight: 3, label: 'SQL built from interpolated input', re: /\$queryRawUnsafe|\$executeRawUnsafe|\b(query|execute|raw)\s*\(\s*`[^`]*\$\{|\.execute\(\s*f["']|cursor\.execute\([^)]*%\s*\(/ },
  { id: 'weak-random', persona: 'security', weight: 2, label: 'Math.random used for a secret value', re: /Math\.random\(\)/, when: (l) => /token|secret|password|nonce|salt|session|otp|key\b|code\b/i.test(l) },
  { id: 'weak-hash', persona: 'security', weight: 2, label: 'Weak hash algorithm', re: /createHash\(\s*['"](md5|sha1)['"]|hashlib\.(md5|sha1)\(/ },
  { id: 'cors-any', persona: 'security', weight: 2, label: 'Permissive CORS', re: /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|\bcors\(\s*\)/ },
  { id: 'tls-off', persona: 'security', weight: 3, label: 'Signature or TLS verification disabled', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|algorithms?\s*:\s*\[?\s*['"]none['"]|NODE_TLS_REJECT_UNAUTHORIZED/ },
  { id: 'hardcoded-secret', persona: 'security', weight: 3, label: 'Hard-coded credential', re: SECRET_ASSIGNMENT, when: (l, ctx) => !ctx.isTest && !PLACEHOLDER_VALUE.test(l) },
  { id: 'log-secret', persona: 'devops', weight: 2, label: 'Sensitive value may be logged', re: /console\.(log|info|debug)\([^)]*\b(token|password|secret|apiKey|authorization)\b/i },
  // data integrity
  { id: 'float-money', persona: 'data_integrity', weight: 3, label: 'Floating-point arithmetic on money', re: /\btoFixed\s*\(|\bparseFloat\s*\(|Math\.round\s*\([^)]*\*\s*100/, when: (l) => MONEY.test(l) },
  { id: 'float-money-schema', persona: 'data_integrity', weight: 3, label: 'Money stored as a float', re: /\b(amount|price|total|balance|cost|fee)\w*\s+(Float|float|real|double)\b/i, when: (_l, ctx) => /\.(prisma|sql)$|models?\.py$|schema\./.test(ctx.path) },
  { id: 'rmw-counter', persona: 'data_integrity', weight: 2, label: 'Read-modify-write on a shared counter', re: /\b(balance|stock|quantity|inventory|credits?|count)\s*[+-]=|\b(balance|stock|quantity|credits?)\s*:\s*\w+\.(balance|stock|quantity|credits?)\s*[+-]/i },
  // reliability
  { id: 'net-no-timeout', persona: 'reliability', weight: 2, label: 'Network call without a timeout', re: /\bfetch\s*\(|\baxios(\.(get|post|put|patch|delete|request))?\s*\(|\bgot\s*\(|requests\.(get|post|put|delete|patch)\(/, when: (_l, ctx) => !ctx.hasTimeout && !ctx.isTest },
  { id: 'retry', persona: 'reliability', weight: 2, label: 'Retry loop — is the retried call idempotent?', re: /\bretr(y|ies|ying)\b|\battempts?\s*[<+]=?|for\s*\(\s*let\s+attempt/i },
  { id: 'swallowed-error', persona: 'reliability', weight: 1, label: 'Error swallowed silently', re: /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}|except\s*:\s*pass|except\s+\w+\s*:\s*pass/ },
  { id: 'unbounded-query', persona: 'reliability', weight: 1, label: 'Query with no limit', re: /\.findMany\(\s*\)|\.find\(\s*\{\s*\}\s*\)|SELECT \* FROM \w+\s*;?\s*["'`]/i },
  { id: 'n-plus-1', persona: 'reliability', weight: 2, label: 'Query or request inside a loop (N+1)', re: /await\s+[\w.]*\.(find\w*|get\w*|query|select|fetch\w*|load\w*|count)\s*\(|await\s+fetch\(/, when: (_l, ctx) => ctx.inLoop },
  { id: 'unbounded-loop', persona: 'reliability', weight: 1, label: 'Unbounded loop or timer', re: /setInterval\s*\(|while\s*\(\s*true\s*\)|while True:/ },
  // quality
  { id: 'todo', persona: 'quality', weight: 1, label: 'Unfinished-work marker', re: /\b(TODO|FIXME|HACK|XXX)\b/ },
  { id: 'focused-test', persona: 'quality', weight: 2, label: 'Skipped or focused test', re: /\b(it|test|describe)\.(only|skip)\s*\(|\bxit\s*\(|@pytest\.mark\.skip/, when: (_l, ctx) => ctx.isTest },
  // product & ux
  { id: 'img-no-alt', persona: 'product_ux', weight: 1, label: 'Image without alt text', re: /<img\b(?![^>]*\balt=)/ },
  { id: 'click-div', persona: 'product_ux', weight: 1, label: "Clickable element that isn't a button", re: /<(div|span|li)\b[^>]*\bonClick=/ },
  { id: 'form-no-pending', persona: 'product_ux', weight: 2, label: 'Form without a pending/disabled state', re: /onSubmit=|<form\b/, when: (_l, ctx) => !ctx.hasPending },
  // devops
  { id: 'docker-unpinned', persona: 'devops', weight: 1, label: 'Unpinned base image', re: /^FROM\s+(\S+:latest|[^:\s@]+)\s*(AS\s+\w+)?\s*$/i, when: (_l, ctx) => /(^|\/)Dockerfile[^/]*$/.test(ctx.path) },
  { id: 'migrate-at-startup', persona: 'devops', weight: 2, label: 'Schema changes applied at startup', re: /prisma migrate deploy|\.migrate\(\)|sequelize\.sync\(|synchronize\s*:\s*true|db\.create_all\(/ },
  // algorithms
  { id: 'lookup-in-loop', persona: 'algorithms', weight: 2, label: 'Linear lookup inside a loop', re: /\.(find|filter|some|every|includes|indexOf|findIndex)\s*\(/, when: (_l, ctx) => ctx.inLoop },
  { id: 'sort-in-loop', persona: 'algorithms', weight: 1, label: 'Sort inside a loop', re: /\.sort\s*\(/, when: (_l, ctx) => ctx.inLoop },
  { id: 'json-clone', persona: 'algorithms', weight: 1, label: 'Deep clone via JSON round-trip', re: /JSON\.parse\s*\(\s*JSON\.stringify/ },
  // ai/ml
  { id: 'model-call', persona: 'ai_ml', weight: 2, label: 'Model call', re: /chat\.completions\.create|messages\.create\(|generateText\(|streamText\(|generateObject\(|generateContent\(|new OpenAI\(|new Anthropic\(|ChatOpenAI|ChatAnthropic/ },
  { id: 'prompt-interp', persona: 'ai_ml', weight: 2, label: 'Prompt built from interpolated input', re: /(prompt|system|instructions?|content)\s*[:=]\s*`[^`]*\$\{/i, when: (_l, ctx) => ctx.aiFile },
  { id: 'model-output-parse', persona: 'ai_ml', weight: 2, label: 'Model output parsed without validation', re: /JSON\.parse\(\s*[\w.?]*(completion|response|content|output|text|message|choices)/i, when: (_l, ctx) => ctx.aiFile },
];

const indentOf = (line) => /^\s*/.exec(line)[0].replace(/\t/g, '  ').length;

/** True when a loop header with smaller indentation opens within the 8 lines above. */
function insideLoop(lines, i) {
  const own = indentOf(lines[i]);
  for (let j = i - 1; j >= Math.max(0, i - 8); j -= 1) {
    if (LOOP.test(lines[j]) && indentOf(lines[j]) <= own) return true;
  }
  return LOOP.test(lines[i]) && /\.(find|filter|some|includes|indexOf)\s*\(.*\.(find|filter|some|includes|indexOf)\s*\(/.test(lines[i]);
}

const ENV_USE = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]|import\.meta\.env\.([A-Z][A-Z0-9_]*)|os\.environ(?:\.get)?\(?\[?\s*['"]([A-Z][A-Z0-9_]*)['"]|os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
const ENV_BUILTIN = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'CI', 'TZ', 'PWD', 'HOSTNAME', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'NEXT_RUNTIME', 'DEBUG']);

const MAX_PER_RULE_PER_FILE = 3;
const MAX_HITS = 600;

/**
 * Scans readable files. Returns { hits, fileLines, envVars, project } where each
 * hit is { persona, rule, label, path, line, weight } (path null = project level).
 */
export function scanHotspots(files, reader, map) {
  const hits = [];
  const fileLines = new Map();
  const envUses = new Map(); // name -> { path, line }
  const paths = new Set(files.map((f) => f.path));
  const scannable = files.filter((f) => isCodePath(f.path) || /(^|\/)Dockerfile[^/]*$/.test(f.path) || /\.(prisma|sql)$/.test(f.path));

  for (const { path } of scannable) {
    const lines = reader.lines(path);
    if (!lines) continue;
    fileLines.set(path, lines.length);
    const text = lines.join('\n');
    const ctx = {
      path,
      isTest: isTestPath(path),
      hasTimeout: TIMEOUT_MARKERS.test(text),
      hasPending: PENDING_MARKERS.test(text),
      aiFile: /openai|anthropic|@ai-sdk|langchain|generativeai|genai|ollama|completions|llm/i.test(text),
      inLoop: false,
    };
    const perRule = new Map();
    const push = (rule, line, label = rule.label, weight = rule.weight) => {
      const n = perRule.get(rule.id) ?? 0;
      if (n >= MAX_PER_RULE_PER_FILE || hits.length >= MAX_HITS) return;
      perRule.set(rule.id, n + 1);
      hits.push({ persona: rule.persona, rule: rule.id, label, path, line, weight });
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length > 2000) continue; // minified or generated; never worth matching
      ctx.inLoop = false;
      let loopChecked = false;
      for (const rule of LINE_RULES) {
        if (!rule.re.test(line)) continue;
        if (rule.when) {
          if (!loopChecked && (rule.id === 'n-plus-1' || rule.id === 'lookup-in-loop' || rule.id === 'sort-in-loop')) {
            ctx.inLoop = insideLoop(lines, i);
            loopChecked = true;
          }
          if (!rule.when(line, ctx)) continue;
        }
        if (ctx.isTest && rule.id !== 'focused-test' && rule.persona !== 'quality') continue;
        let label = rule.label;
        let weight = rule.weight;
        if (rule.id === 'retry' && PAYMENT_WORDS.test(text) && !IDEMPOTENCY.test(text)) {
          label = 'Retry around a payment/charge with no idempotency key';
          weight = 3;
        }
        push(rule, i + 1, label, weight);
      }
      if (!ctx.isTest) {
        for (const m of line.matchAll(ENV_USE)) {
          const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
          if (name && !ENV_BUILTIN.has(name) && !envUses.has(name)) envUses.set(name, { path, line: i + 1 });
        }
      }
    }

    if (ctx.isTest) continue;

    // Ownership: a route handler that authenticates, then loads/changes a record by id with no owner filter nearby.
    if (ROUTE_FILE.test(path) && AUTH_MARKERS.test(text)) {
      for (let i = 0; i < lines.length; i += 1) {
        if (!BY_ID_ACCESS.test(lines[i])) continue;
        const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        if (!/\bid\b|params|pk\b|_id\b/.test(near) || OWNER_MARKERS.test(near)) continue;
        push({ id: 'ownership', persona: 'security', weight: 3 }, i + 1, 'Record loaded or changed by id after an auth check — ownership not checked nearby');
      }
    }

    // Several writes in one module with no transaction.
    const writes = [];
    lines.forEach((l, i) => {
      if (/\.(create|update|delete|upsert|createMany|updateMany|deleteMany|insert|save)\s*\(/.test(l) && /\b(db|prisma|tx|knex|repo|repository|model|session|client)\b/i.test(l)) writes.push(i + 1);
    });
    if (writes.length >= 2 && !/\$transaction|\.transaction\(|BEGIN\b|atomic\(|with_transaction|session\.begin/.test(text)) {
      push({ id: 'writes-no-tx', persona: 'data_integrity', weight: 2 }, writes[0], `${writes.length} database writes in one module with no transaction`);
    }

    // Client component that imports server code.
    if (/^\s*['"]use client['"]/m.test(text) && /from\s+['"][^'"]*(prisma|\/db\b|server-only|\/server\/|node:fs|['"]fs['"])/.test(text)) {
      const at = lines.findIndex((l) => /from\s+['"][^'"]*(prisma|\/db\b|server-only|\/server\/|node:fs|['"]fs['"])/.test(l));
      push({ id: 'client-imports-server', persona: 'architecture', weight: 3 }, at + 1, 'Client component imports server-side code');
    }

    // UI module that also talks to the database directly.
    const isUi = /\.(tsx|jsx|vue|svelte)$/.test(path) && /return\s*\(?\s*</.test(text);
    if (isUi && /\b(prisma|db)\.\w+\.(find|create|update|delete)|\bquery\s*\(\s*['"`]\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(text)) {
      const at = lines.findIndex((l) => /\b(prisma|db)\.\w+\.(find|create|update|delete)|\bquery\s*\(/.test(l));
      push({ id: 'ui-data-access', persona: 'architecture', weight: 1 }, at + 1, 'UI component queries the database directly');
      push({ id: 'mixed-concerns', persona: 'code_quality', weight: 1 }, at + 1, 'Rendering and data access mixed in one module');
    }

    // Large modules.
    if (isCodePath(path) && lines.length > 400) {
      push({ id: 'large-file', persona: 'code_quality', weight: lines.length > 800 ? 2 : 1 }, 1, `Large module (${lines.length} lines)`);
    }
  }

  // Env vars the code reads that .env.example doesn't document.
  const template = [...paths].find((p) => /(^|\/)\.env\.(example|sample|template)$/.test(p));
  if (envUses.size > 0) {
    if (template) {
      const documented = new Set((reader.read(template) ?? '').split(/\r?\n/).map((l) => /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(l)?.[1]).filter(Boolean));
      let n = 0;
      for (const [name, at] of envUses) {
        if (documented.has(name) || name.startsWith('NEXT_PUBLIC_VERCEL') || n >= 5) continue;
        n += 1;
        hits.push({ persona: 'devops', rule: 'env-undocumented', label: `${name} is read here but missing from ${basename(template)}`, path: at.path, line: at.line, weight: 1 });
      }
    } else if (envUses.size >= 3) {
      const first = envUses.values().next().value;
      hits.push({ persona: 'devops', rule: 'env-no-template', label: `The code reads ${envUses.size} environment variables but no .env.example documents them`, path: first.path, line: first.line, weight: 2 });
    }
  }

  // Project-level facts.
  if (map.testFiles.length === 0) hits.push({ persona: 'quality', rule: 'no-tests', label: 'No automated tests found', path: null, line: null, weight: 3 });
  if (map.ciFiles.length === 0) hits.push({ persona: 'devops', rule: 'no-ci', label: 'No CI configuration found', path: null, line: null, weight: 1 });
  if (map.stack.some((s) => ['kafka', 'rabbitmq', 'bullmq', 'nats'].includes(s))) {
    hits.push({ persona: 'architecture', rule: 'broker', label: 'Message broker in the stack — is the scale there to need it?', path: null, line: null, weight: 1 });
  }

  // Modules with logic but no test that names them (only when the project has tests at all).
  if (map.testFiles.length > 0) {
    const testStems = new Set(map.testFiles.map((t) => basename(t).replace(/\.(test|spec)\.[^.]+$/, '').replace(/^test_|_test\.\w+$|\.\w+$/g, '')));
    let n = 0;
    for (const { path } of scannable) {
      if (n >= 6 || isTestPath(path) || !/(^|\/)(lib|utils?|services?|server|core|domain|helpers?)\//.test(path) || !/\.(t|j)sx?$|\.py$/.test(path)) continue;
      const stem = basename(path).replace(/\.\w+$/, '');
      if (testStems.has(stem) || (fileLines.get(path) ?? 0) < 15) continue;
      n += 1;
      hits.push({ persona: 'quality', rule: 'untested', label: 'No test file covers this module', path, line: 1, weight: 1 });
    }
  }

  return { hits, fileLines, envVars: [...envUses.keys()] };
}

/** Score per persona from hit weights (feeds routing). */
export function personaScores(hits) {
  const scores = {};
  for (const h of hits) scores[h.persona] = (scores[h.persona] ?? 0) + h.weight;
  return scores;
}
