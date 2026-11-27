// Deterministic project map. Ported from src/lib/repo/mapper.ts (no AI involved).
import { basename, extname } from 'node:path';
import { isTestPath } from './files.mjs';

const LANGUAGES = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.scala': 'Scala', '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#',
  '.php': 'PHP', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.clj': 'Clojure', '.hs': 'Haskell',
  '.lua': 'Lua', '.r': 'R', '.m': 'Objective-C', '.sh': 'Shell', '.bash': 'Shell', '.sql': 'SQL',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SCSS', '.less': 'Less', '.html': 'HTML', '.prisma': 'Prisma',
};
const JS_FAMILY = new Set(['TypeScript', 'JavaScript', 'Vue', 'Svelte', 'Astro']);
const SUPPORTING = new Set(['CSS', 'SCSS', 'Less', 'HTML', 'Shell', 'SQL', 'Prisma']);

export const languageOf = (p) => LANGUAGES[extname(p).toLowerCase()] ?? null;
export const isCodePath = (p) => {
  const lang = languageOf(p);
  return lang !== null && !['CSS', 'SCSS', 'Less', 'HTML'].includes(lang);
};

const STACK_RULES = [
  ['next', 'nextjs'], ['react', 'react'], ['vue', 'vue'], ['nuxt', 'nuxt'], ['svelte', 'svelte'], ['@sveltejs/kit', 'sveltekit'],
  ['@angular/core', 'angular'], ['astro', 'astro'], ['@remix-run/', 'remix'], ['express', 'express'], ['fastify', 'fastify'],
  ['koa', 'koa'], ['hono', 'hono'], ['@nestjs/core', 'nestjs'], ['prisma', 'prisma'], ['@prisma/client', 'prisma'],
  ['drizzle-orm', 'drizzle'], ['mongoose', 'mongoose'], ['typeorm', 'typeorm'], ['sequelize', 'sequelize'], ['knex', 'knex'],
  ['pg', 'postgres'], ['mysql2', 'mysql'], ['redis', 'redis'], ['ioredis', 'redis'], ['tailwindcss', 'tailwind'],
  ['jest', 'jest'], ['vitest', 'vitest'], ['mocha', 'mocha'], ['@playwright/test', 'playwright'], ['cypress', 'cypress'],
  ['stripe', 'stripe'], ['next-auth', 'nextauth'], ['@auth/', 'authjs'], ['@clerk/', 'clerk'], ['@supabase/supabase-js', 'supabase'],
  ['firebase', 'firebase'], ['firebase-admin', 'firebase'], ['graphql', 'graphql'], ['@trpc/server', 'trpc'], ['zod', 'zod'],
  ['typescript', 'typescript'], ['electron', 'electron'], ['react-native', 'react-native'], ['expo', 'expo'],
  ['kafkajs', 'kafka'], ['amqplib', 'rabbitmq'], ['bullmq', 'bullmq'], ['nats', 'nats'],
  // Python (requirements / pyproject names)
  ['django', 'django'], ['flask', 'flask'], ['fastapi', 'fastapi'], ['sqlalchemy', 'sqlalchemy'], ['celery', 'celery'], ['pytest', 'pytest'],
];

const AI_DEPENDENCIES = [
  'openai', '@anthropic-ai/sdk', 'anthropic', 'langchain', '@langchain/', 'ai', '@ai-sdk/', '@google/generative-ai', '@google/genai',
  'google-generativeai', 'google-genai', 'llamaindex', 'llama-index', 'cohere-ai', 'cohere', '@mistralai/mistralai', 'mistralai',
  'groq-sdk', 'groq', 'ollama', 'replicate', '@huggingface/inference', 'transformers', '@pinecone-database/pinecone', 'pinecone-client',
  'chromadb', 'tiktoken', 'sentence-transformers', 'torch', 'tensorflow', 'scikit-learn',
];

const depMatches = (dep, rule) => (rule.endsWith('/') ? dep.startsWith(rule) : dep === rule);

const CONFIG_PATTERNS = [
  /(^|\/)tsconfig(\.[^/]+)?\.json$/, /(^|\/)jsconfig\.json$/,
  /(^|\/)(next|vite|nuxt|svelte|astro|remix|webpack|rollup|tailwind|postcss|babel|jest|vitest|playwright|cypress|drizzle)\.config\.[^/]+$/,
  /(^|\/)eslint\.config\.[^/]+$/, /(^|\/)\.eslintrc(\.[^/]+)?$/, /(^|\/)Dockerfile[^/]*$/, /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)compose\.ya?ml$/, /(^|\/)prisma\/schema\.prisma$/, /(^|\/)vercel\.json$/, /(^|\/)netlify\.toml$/, /(^|\/)fly\.toml$/,
  /(^|\/)render\.yaml$/, /(^|\/)Procfile$/, /(^|\/)\.env\.(example|sample|template)$/, /(^|\/)prisma\.config\.[^/]+$/,
  /(^|\/)(pyproject\.toml|setup\.cfg|settings\.py)$/, /(^|\/)(go\.mod|Cargo\.toml|Gemfile)$/, /(^|\/)(k8s|kubernetes|helm)\/.+\.ya?ml$/,
];
const CI_PATTERNS = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/, /^\.gitlab-ci\.ya?ml$/, /^\.circleci\/config\.ya?ml$/, /^azure-pipelines\.ya?ml$/,
  /^bitbucket-pipelines\.ya?ml$/, /^\.travis\.ya?ml$/, /^Jenkinsfile$/, /^\.buildkite\/.+\.ya?ml$/,
];
const CODE_EXT = String.raw`\.(tsx?|jsx?|mjs|cjs|mts|cts)$`;
const ENTRY_PATTERNS = [
  new RegExp(String.raw`^(src/)?app/(.+/)?(page|route|layout)` + CODE_EXT),
  new RegExp(String.raw`^(src/)?pages/.+` + CODE_EXT),
  new RegExp(String.raw`^src/(index|main|server|app)` + CODE_EXT),
  new RegExp(String.raw`^(src/)?server` + CODE_EXT),
  new RegExp(String.raw`^(src/)?(middleware|proxy)` + CODE_EXT),
  /^(main|app|manage|wsgi|asgi|server)\.py$/, /(^|\/)main\.go$/, /^src\/main\.rs$/, /^(index|server|app)\.(js|ts|mjs)$/,
];

export function parsePackageJson(path, text) {
  try {
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : []);
    const scripts = json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
    return { path, name: typeof json.name === 'string' ? json.name : undefined, dependencies: keys(json.dependencies), devDependencies: keys(json.devDependencies), scripts };
  } catch {
    return null;
  }
}

/**
 * Dependency names (best effort, names only). requirements.txt: one requirement per line.
 * pyproject.toml: quoted PEP 508 strings ("fastapi>=0.1") and poetry-style keys (fastapi = "^0.1").
 */
function pythonDeps(text, isPyproject) {
  const deps = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    if (isPyproject) {
      for (const m of line.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:[<>=~!;][^"']*)?["']/g)) deps.add(m[1].toLowerCase());
      const key = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
      if (key) deps.add(key[1].toLowerCase());
    } else {
      const req = /^([A-Za-z0-9_.-]+)/.exec(line);
      if (req) deps.add(req[1].toLowerCase());
    }
  }
  return [...deps];
}

export function buildProjectMap(files, reader) {
  const paths = files.map((f) => f.path);
  const languages = {};
  for (const p of paths) {
    const lang = languageOf(p);
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const manifests = [];
  const otherDeps = new Set();
  for (const p of paths) {
    const base = basename(p);
    if (base === 'package.json') {
      const text = reader.read(p);
      const m = text === null ? null : parsePackageJson(p, text);
      if (m) manifests.push(m);
    } else if (base === 'requirements.txt' || base === 'pyproject.toml') {
      const text = reader.read(p);
      if (text) for (const d of pythonDeps(text, base === 'pyproject.toml')) otherDeps.add(d);
    }
  }
  const allDeps = new Set([...manifests.flatMap((m) => [...m.dependencies, ...m.devDependencies]), ...otherDeps]);
  const stack = new Set();
  for (const dep of allDeps) for (const [rule, label] of STACK_RULES) if (depMatches(dep, rule)) stack.add(label);
  if ((languages.TypeScript ?? 0) > 0) stack.add('typescript');
  if (paths.some((p) => /(^|\/)prisma\/schema\.prisma$/.test(p))) stack.add('prisma');
  if (paths.some((p) => /(^|\/)go\.mod$/.test(p))) stack.add('go');
  if (paths.some((p) => /(^|\/)Cargo\.toml$/.test(p))) stack.add('rust');
  const usesAI = [...allDeps].some((dep) => AI_DEPENDENCIES.some((rule) => depMatches(dep, rule)));

  let js = 0;
  let topOther = 0;
  for (const [lang, count] of Object.entries(languages)) {
    if (JS_FAMILY.has(lang)) js += count;
    else if (!SUPPORTING.has(lang)) topOther = Math.max(topOther, count);
  }
  return {
    fileCount: files.length,
    languages,
    stack: [...stack].sort(),
    manifests,
    configFiles: paths.filter((p) => CONFIG_PATTERNS.some((re) => re.test(p))),
    testFiles: paths.filter((p) => languageOf(p) !== null && isTestPath(p)),
    ciFiles: paths.filter((p) => CI_PATTERNS.some((re) => re.test(p))),
    entryPoints: paths.filter((p) => ENTRY_PATTERNS.some((re) => re.test(p))),
    migrations: paths.filter((p) => /(^|\/)(prisma\/migrations|migrations|drizzle|db\/migrate|alembic\/versions)\//.test(p)).sort(),
    usesAI,
    primarySupported: js > 0 && js >= topOther,
  };
}

/** Indented tree within `maxLines`; deep folders collapse to `dir/ (N files)`. Ported from mapper.ts. */
export function renderTree(paths, maxLines = 40) {
  const root = { dirs: new Map(), files: [], total: 0 };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    node.total += 1;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [], total: 0 });
      node = node.dirs.get(part);
      node.total += 1;
    }
    node.files.push(parts[parts.length - 1]);
  }
  const expanded = new Set([root]);
  let used = root.dirs.size + root.files.length;
  const queue = [...root.dirs.values()];
  while (queue.length > 0) {
    const node = queue.shift();
    const cost = node.dirs.size + node.files.length;
    if (used + cost > maxLines) continue;
    expanded.add(node);
    used += cost;
    queue.push(...node.dirs.values());
  }
  const lines = [];
  const visit = (node, indent) => {
    for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      if (expanded.has(dir)) {
        lines.push(`${indent}${dir.name}/`);
        visit(dir, `${indent}  `);
      } else lines.push(`${indent}${dir.name}/ (${dir.total} files)`);
    }
    for (const f of [...node.files].sort()) lines.push(`${indent}${f}`);
  };
  visit(root, '');
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more entries)`].join('\n') : lines.join('\n');
}
