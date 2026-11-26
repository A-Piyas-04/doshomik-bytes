// Reads the backend and writes .api-guide/facts.json, the data behind docs/api-guide.html.
//
// Two passes, cross-checked:
//   1. Runtime: boots the real Fastify app (buildApp) without listening and records every route
//      as Fastify registered it, with its zod request schemas turned into JSON Schema and its
//      rate limit. Nothing connects to the database (the pool is lazy).
//   2. Static: parses apps/api/src with rolldown's TypeScript parser (already installed for
//      vitest) and follows each route handler through the code: which functions it calls, which
//      tables they read and write, which outbox events, audit actions and errors they produce.
//      The worker loops and outbox handlers are followed the same way.
//
// Run it with `node .api-guide/run.mjs` (see .api-guide/README.md). Nothing here is imported by the app.

import dc from 'node:diagnostics_channel';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const API = path.join(ROOT, 'apps', 'api');
const SRC = path.join(API, 'src');
const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

// ---------------------------------------------------------------- parser (rolldown → oxc)

function findRolldownParser(): string {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  const dirs = existsSync(pnpmDir) ? readdirSync(pnpmDir).filter((d) => d.startsWith('rolldown@')).sort().reverse() : [];
  for (const d of dirs) {
    const file = path.join(pnpmDir, d, 'node_modules', 'rolldown', 'dist', 'parse-ast-index.mjs');
    if (existsSync(file)) return file;
  }
  throw new Error('rolldown is not installed (it comes with vitest). Run pnpm install first.');
}
const { parseAst } = (await import(pathToFileURL(findRolldownParser()).href)) as {
  parseAst: (code: string, options: { lang: 'ts' }) => any;
};

type Node = any;

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const key in node) {
    if (key === 'parent' || key === 'typeAnnotation' || key === 'typeArguments' || key === 'returnType' || key === 'typeParameters') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === 'object' && typeof v.type === 'string') out.push(v);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') out.push(value);
  }
  return out;
}

function walk(node: Node, visit: (n: Node) => void | false): void {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}

const isFn = (n: Node) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration');

// ---------------------------------------------------------------- source index

interface SourceFile {
  abs: string;
  rel: string;
  src: string;
  ast: Node;
  lineStarts: number[];
  imports: Map<string, { file: string | null; name: string }>; // name '*' for namespace imports
  decls: Map<string, { node: Node; stmtStart: number }>;
}

const files = new Map<string, SourceFile>();

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function resolveSpecifier(fromAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function load(abs: string): SourceFile {
  const cached = files.get(abs);
  if (cached) return cached;
  const src = readFileSync(abs, 'utf8');
  const ast = parseAst(src, { lang: 'ts' });
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const file: SourceFile = { abs, rel: rel(abs), src, ast, lineStarts, imports: new Map(), decls: new Map() };
  for (const stmt of ast.body) {
    if (stmt.type === 'ImportDeclaration') {
      const target = resolveSpecifier(abs, stmt.source.value);
      for (const s of stmt.specifiers) {
        if (s.type === 'ImportNamespaceSpecifier') file.imports.set(s.local.name, { file: target, name: '*' });
        else if (s.type === 'ImportDefaultSpecifier') file.imports.set(s.local.name, { file: target, name: 'default' });
        else file.imports.set(s.local.name, { file: target, name: s.imported.name ?? s.imported.value });
      }
      continue;
    }
    const decl = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : stmt;
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration' && decl.id) file.decls.set(decl.id.name, { node: decl, stmtStart: stmt.start });
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id?.type === 'Identifier' && d.init) file.decls.set(d.id.name, { node: d.init, stmtStart: stmt.start });
      }
    }
  }
  files.set(abs, file);
  return file;
}

const lineOf = (file: SourceFile, offset: number) => {
  let lo = 0;
  let hi = file.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (file.lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

/** The comment right above a statement: a JSDoc block or a run of // lines. */
function docAbove(file: SourceFile, offset: number): string | null {
  const before = file.src.slice(0, offset).replace(/[ \t]+$/, '');
  const trimmed = before.replace(/\s+$/, '');
  if (trimmed.endsWith('*/')) {
    const open = trimmed.lastIndexOf('/*');
    if (open < 0) return null;
    // Only when nothing but whitespace separates it from the statement's line.
    const gap = before.slice(trimmed.length);
    if ((gap.match(/\n/g) ?? []).length > 1) return null;
    return cleanComment(trimmed.slice(open));
  }
  const lines = before.split('\n');
  lines.pop(); // the statement's own line (text before it on that line is indentation)
  const out: string[] = [];
  while (lines.length) {
    const line = lines[lines.length - 1]!.trim();
    if (!line.startsWith('//')) break;
    out.unshift(line.replace(/^\/\/\s?/, ''));
    lines.pop();
  }
  return out.length ? out.join(' ').trim() : null;
}

function cleanComment(block: string): string {
  return block
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

// ---------------------------------------------------------------- values

type Bindings = Record<string, string>;

/** The file being analysed, for lookups that read file-level constants. */
let currentFile: SourceFile | null = null;
/** Functions declared inside a function or plugin body, by file (e.g. selectItems() inside a plugin). */
const scopeStack: { file: SourceFile; fns: Map<string, Node> }[] = [];

function nestedFns(body: Node): Map<string, Node> {
  const map = new Map<string, Node>();
  walk(body, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && isFn(n.init)) map.set(n.id.name, n.init);
    if (n.type === 'FunctionDeclaration' && n.id) map.set(n.id.name, n);
  });
  return map;
}

/** The string values an expression can have, as far as can be read without running it. */
function strings(node: Node, bindings: Bindings, locals?: Map<string, Node>, depth = 0): string[] {
  if (!node || depth > 6) return [];
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [node.value] : [];
    case 'TemplateLiteral': {
      let parts = [''];
      node.quasis.forEach((q: Node, i: number) => {
        parts = parts.map((p) => p + (q.value.cooked ?? q.value.raw));
        const expr = node.expressions[i];
        if (expr) {
          const values = strings(expr, bindings, locals, depth + 1);
          const options = values.length ? values : ['…'];
          parts = parts.flatMap((p) => options.map((o) => p + o));
        }
      });
      return parts;
    }
    case 'Identifier':
      if (node.name in bindings) return [bindings[node.name]!];
      if (locals?.has(node.name)) return strings(locals.get(node.name), bindings, locals, depth + 1);
      return [];
    case 'MemberExpression': {
      if (node.computed && node.object.type === 'Identifier' && currentFile) {
        // ENTITY[table], with `table` bound: read the file-level lookup object.
        const obj = currentFile.decls.get(node.object.name)?.node;
        const keys = strings(node.property, bindings, locals, depth + 1);
        const unwrapped = obj?.type === 'TSAsExpression' || obj?.type === 'TSSatisfiesExpression' ? obj.expression : obj;
        if (unwrapped?.type === 'ObjectExpression' && keys.length) return keys.flatMap((k) => strings(prop(unwrapped, k), bindings, locals, depth + 1));
        return [];
      }
      const chain = memberChain(node).join('.');
      return chain in bindings ? [bindings[chain]!] : [];
    }
    case 'ConditionalExpression': {
      // minimum === 'admin' ? … : …, with `minimum` bound: take the branch it selects.
      const t = node.test;
      if (t.type === 'BinaryExpression' && (t.operator === '===' || t.operator === '!==') && t.left.type === 'Identifier' && t.left.name in bindings) {
        const right = strings(t.right, bindings, locals, depth + 1);
        if (right.length === 1) {
          const equal = bindings[t.left.name] === right[0];
          const pick = equal === (t.operator === '===') ? node.consequent : node.alternate;
          return strings(pick, bindings, locals, depth + 1);
        }
      }
    }
    // falls through
    case 'ConditionalExpression_both':
      return [...strings(node.consequent, bindings, locals, depth + 1), ...strings(node.alternate, bindings, locals, depth + 1)];
    case 'LogicalExpression':
      return [...strings(node.left, bindings, locals, depth + 1), ...strings(node.right, bindings, locals, depth + 1)];
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return strings(node.expression, bindings, locals, depth + 1);
    default:
      return [];
  }
}

function number(node: Node): number | null {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'BinaryExpression') {
    const a = number(node.left);
    const b = number(node.right);
    if (a === null || b === null) return null;
    if (node.operator === '*') return a * b;
    if (node.operator === '+') return a + b;
    if (node.operator === '-') return a - b;
    if (node.operator === '/') return a / b;
  }
  return null;
}

const prop = (obj: Node, name: string) =>
  obj?.type === 'ObjectExpression'
    ? obj.properties.find((p: Node) => p.type === 'Property' && (p.key.name === name || p.key.value === name))?.value
    : undefined;

/** Every `const x = …` inside a function, for reading literal values through a local name. */
function localsOf(fn: Node): Map<string, Node> {
  const map = new Map<string, Node>();
  walk(fn, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) map.set(n.id.name, n.init);
  });
  return map;
}

// ---------------------------------------------------------------- database tables

const typesSrc = readFileSync(path.join(SRC, 'db', 'types.ts'), 'utf8');
const dbBlock = typesSrc.slice(typesSrc.indexOf('export interface DB {'));
const TABLES = new Set([...dbBlock.slice(0, dbBlock.indexOf('}')).matchAll(/^\s+([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]!));

const READ_METHODS = new Set(['selectFrom', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin', 'crossJoin', 'innerJoinLateral', 'leftJoinLateral']);
const WRITE_METHODS: Record<string, 'insert' | 'update' | 'delete'> = {
  insertInto: 'insert',
  insertIgnoreInto: 'insert',
  replaceInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
  mergeInto: 'update',
};

const tableName = (raw: string) => raw.trim().split(/\s+as\s+/i)[0]!.trim().replace(/^public\./, '');

// ---------------------------------------------------------------- function analysis

type Op = 'read' | 'insert' | 'update' | 'delete';

interface Facts {
  tables: Map<string, Set<Op>>;
  events: Set<string>;
  searchSync: Set<string>;
  audits: Set<string>;
  errors: Map<string, { status: number; code: string; message: string }>;
  notifications: Set<string>;
  providers: Set<string>; // email, push, google, scholarly, storage
  calls: string[]; // direct callees (function ids)
  statuses: Set<number>;
}

const emptyFacts = (): Facts => ({
  tables: new Map(),
  events: new Set(),
  searchSync: new Set(),
  audits: new Set(),
  errors: new Map(),
  notifications: new Set(),
  providers: new Set(),
  calls: [],
  statuses: new Set(),
});

function addTable(f: Facts, table: string, op: Op) {
  if (!TABLES.has(table)) return;
  if (!f.tables.has(table)) f.tables.set(table, new Set());
  f.tables.get(table)!.add(op);
}

function merge(into: Facts, from: Facts) {
  for (const [t, ops] of from.tables) for (const op of ops) addTable(into, t, op);
  for (const k of ['events', 'searchSync', 'audits', 'notifications', 'providers'] as const) for (const v of from[k]) into[k].add(v);
  for (const [k, v] of from.errors) into.errors.set(k, v);
}

interface FnRecord {
  id: string;
  file: string;
  name: string;
  line: number;
  doc: string | null;
  calls: string[];
  own: ReturnType<typeof serializeFacts>;
}
const functions = new Map<string, FnRecord>();

interface Target {
  file: SourceFile;
  name: string;
  node: Node;
  stmtStart: number;
}

function lookup(file: SourceFile, name: string, seen = 0): Target | null {
  const decl = file.decls.get(name);
  if (decl) return { file, name, node: decl.node, stmtStart: decl.stmtStart };
  const imp = file.imports.get(name);
  if (imp?.file && imp.name !== '*' && seen < 5) return lookup(load(imp.file), imp.name, seen + 1);
  return null;
}

/** What a call expression's callee refers to inside apps/api/src, if anything. */
function resolveCallee(file: SourceFile, callee: Node): Target | null {
  if (callee.type === 'Identifier') {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const scope = scopeStack[i]!;
      const node = scope.file === file ? scope.fns.get(callee.name) : undefined;
      if (node) return { file, name: callee.name, node, stmtStart: node.start };
    }
    return lookup(file, callee.name);
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') {
    const imp = file.imports.get(callee.object.name);
    if (imp?.file && imp.name === '*') return lookup(load(imp.file), callee.property.name);
  }
  return null;
}

const fnId = (t: Target) => `${t.file.rel}#${t.name}`;
const ERROR_FILE = rel(path.join(SRC, 'lib', 'errors.ts'));
const OUTBOX_FILE = rel(path.join(SRC, 'lib', 'outbox.ts'));
const AUDIT_FILE = rel(path.join(SRC, 'lib', 'audit.ts'));
const NOTIFY_FILE = rel(path.join(SRC, 'worker', 'notify.ts'));

const ERROR_HELPERS: Record<string, { status: number; code: string; msgArg: number; codeArg: number | null; defaultMsg?: string }> = {
  badRequest: { status: 400, code: 'BAD_REQUEST', msgArg: 0, codeArg: 1 },
  unauthorized: { status: 401, code: 'UNAUTHORIZED', msgArg: 0, codeArg: 1, defaultMsg: 'Authentication required' },
  forbidden: { status: 403, code: 'FORBIDDEN', msgArg: 0, codeArg: 1, defaultMsg: 'You are not allowed to do this' },
  notFound: { status: 404, code: 'NOT_FOUND', msgArg: 0, codeArg: null },
  found: { status: 404, code: 'NOT_FOUND', msgArg: 1, codeArg: null },
  conflict: { status: 409, code: 'CONFLICT', msgArg: 0, codeArg: 1 },
};

const memo = new Map<string, Facts>();
const inProgress = new Set<string>();

/** Facts for a function body, including everything it calls (transitively). */
function analyzeBody(file: SourceFile, fn: Node, bindings: Bindings, ownerId: string | null): Facts {
  const own = emptyFacts();
  const total = emptyFacts();
  const locals = localsOf(fn);
  const callees: string[] = [];
  const outerFile = currentFile;
  currentFile = file;
  scopeStack.push({ file, fns: nestedFns(fn) });

  walk(fn, (n) => {
    currentFile = file;
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'HttpError') {
      const status = number(n.arguments[0]) ?? 500;
      const code = strings(n.arguments[1], bindings, locals)[0] ?? '?';
      own.errors.set(`${status} ${code}`, { status, code, message: strings(n.arguments[2], bindings, locals)[0] ?? '' });
    }

    if (n.type === 'TaggedTemplateExpression') {
      const tag = n.tag.type === 'Identifier' ? n.tag.name : n.tag.type === 'MemberExpression' ? n.tag.object?.name : null;
      if (tag === 'sql') readSqlTemplate(n.quasi, bindings, locals, own);
    }

    // searchers[type](…) or handlers[event.type]: a lookup in a file-level object of functions reaches all of them.
    if (n.type === 'MemberExpression' && n.computed && n.object.type === 'Identifier') {
      let obj = file.decls.get(n.object.name)?.node;
      while (obj && (obj.type === 'TSAsExpression' || obj.type === 'TSSatisfiesExpression')) obj = obj.expression;
      if (obj?.type === 'ObjectExpression') {
        for (const p of obj.properties) {
          if (p.type !== 'Property' || !isFn(p.value)) continue;
          const t: Target = { file, name: `${n.object.name}.${p.key.name ?? p.key.value}`, node: p.value, stmtStart: p.start };
          const id = fnId(t);
          if (!callees.includes(id)) callees.push(id);
          merge(total, analyzeFunction(t, {}));
        }
      }
    }

    // for (const job of [purgeDeletedAccounts, …]) await job(log): functions listed in an array are called.
    if (n.type === 'ArrayExpression') {
      for (const el of n.elements) {
        if (el?.type !== 'Identifier') continue;
        const t = resolveCallee(file, el);
        if (!t || !isFn(t.node)) continue;
        const id = fnId(t);
        if (!callees.includes(id)) callees.push(id);
        merge(total, analyzeFunction(t, {}));
      }
    }

    if (n.type !== 'CallExpression') return;
    const callee = n.callee;

    // reply.status(201) / reply.code(204) / reply.redirect()
    if (callee.type === 'MemberExpression' && !callee.computed) {
      const p = callee.property.name;
      if ((p === 'status' || p === 'code') && n.arguments.length === 1) {
        const s = number(n.arguments[0]);
        if (s !== null && rootName(callee.object) === 'reply') own.statuses.add(s);
      }
      if (p === 'redirect' && rootName(callee.object) === 'reply') own.statuses.add(302);
      if (p === 'sendFile' && rootName(callee.object) === 'reply') own.providers.add('storage');

      // Kysely builders: trx.selectFrom('posts as p'), .innerJoin('users as u', …), .insertInto(…)
      if (READ_METHODS.has(p) || p in WRITE_METHODS) {
        const op: Op = READ_METHODS.has(p) ? 'read' : WRITE_METHODS[p]!;
        const arg = n.arguments[0];
        const values = arg?.type === 'ArrayExpression' ? arg.elements.flatMap((e: Node) => strings(e, bindings, locals)) : strings(arg, bindings, locals);
        if (arg?.type === 'CallExpression' && arg.callee?.property?.name === 'table') {
          for (const v of strings(arg.arguments[0], bindings, locals)) addTable(own, tableName(v), op);
        }
        for (const v of values) addTable(own, tableName(v), op);
      }

      // providers.email.send(…), providers.push.send(…), localStorage.deleteRaw(…)
      const chain = memberChain(callee);
      if (chain[0] === 'providers' && chain[1]) own.providers.add(chain[1]);
      if (chain[0] === 'localStorage' || chain[0] === 'storage') own.providers.add('storage');
    }

    const target = resolveCallee(file, callee);
    if (!target) return;
    const tFile = target.file.rel;

    if (tFile === ERROR_FILE && target.name in ERROR_HELPERS) {
      const h = ERROR_HELPERS[target.name]!;
      const code = (h.codeArg !== null && strings(n.arguments[h.codeArg], bindings, locals)[0]) || h.code;
      let message = strings(n.arguments[h.msgArg], bindings, locals)[0] ?? h.defaultMsg ?? '…';
      if (target.name === 'notFound' || target.name === 'found') message = `${message} not found`;
      own.errors.set(`${h.status} ${code} ${message}`, { status: h.status, code, message });
      return;
    }
    if (tFile === OUTBOX_FILE && target.name === 'emit') {
      for (const e of strings(n.arguments[1], bindings, locals)) own.events.add(e);
      own.tables.set('outbox_events', new Set(['insert']));
      return;
    }
    if (tFile === OUTBOX_FILE && target.name === 'emitSearchSync') {
      own.events.add('search.sync');
      for (const e of strings(n.arguments[1], bindings, locals)) own.searchSync.add(e);
      own.tables.set('outbox_events', new Set(['insert']));
      return;
    }
    if (tFile === AUDIT_FILE && target.name === 'audit') {
      for (const a of strings(prop(n.arguments[2], 'action'), bindings, locals)) own.audits.add(a);
      addTable(own, 'audit_log', 'insert');
      return;
    }
    if (tFile === NOTIFY_FILE && target.name === 'notify') {
      for (const t of strings(prop(n.arguments[1], 'type'), bindings, locals)) own.notifications.add(t);
    }

    const targetFn = isFn(target.node) ? target.node : null;
    if (!targetFn) return;

    // Literal arguments flow into the callee's parameters (lifecycleRoutes('/papers', 'papers') → table).
    const childBindings: Bindings = {};
    targetFn.params.forEach((param: Node, i: number) => {
      const name = param.type === 'Identifier' ? param.name : param.left?.type === 'Identifier' ? param.left.name : null;
      const value = n.arguments[i] ? strings(n.arguments[i], bindings, locals) : [];
      if (name && value.length === 1) childBindings[name] = value[0]!;
    });
    const id = fnId(target);
    if (!callees.includes(id)) callees.push(id);
    merge(total, analyzeFunction(target, childBindings));
  });

  scopeStack.pop();
  currentFile = outerFile;
  own.calls = callees;
  if (ownerId && functions.has(ownerId)) {
    functions.get(ownerId)!.calls = callees;
    functions.get(ownerId)!.own = serializeFacts(own);
  }
  merge(total, own);
  total.calls = callees;
  for (const s of own.statuses) total.statuses.add(s);
  return total;
}

function analyzeFunction(target: Target, bindings: Bindings): Facts {
  const id = fnId(target);
  const key = `${id}|${JSON.stringify(bindings)}`;
  const cached = memo.get(key);
  if (cached) return cached;
  if (inProgress.has(key)) return emptyFacts();
  inProgress.add(key);
  if (!functions.has(id)) {
    functions.set(id, {
      id,
      file: target.file.rel,
      name: target.name,
      line: lineOf(target.file, target.stmtStart),
      doc: docAbove(target.file, target.stmtStart),
      calls: [],
      own: serializeFacts(emptyFacts()),
    });
  }
  const facts = analyzeBody(target.file, target.node, bindings, id);
  inProgress.delete(key);
  memo.set(key, facts);
  return facts;
}

function rootName(node: Node): string | null {
  while (node && (node.type === 'MemberExpression' || node.type === 'CallExpression')) node = node.type === 'CallExpression' ? node.callee : node.object;
  return node?.type === 'Identifier' ? node.name : null;
}

function memberChain(node: Node): string[] {
  const out: string[] = [];
  while (node?.type === 'MemberExpression' && !node.computed) {
    out.unshift(node.property.name);
    node = node.object;
  }
  if (node?.type === 'Identifier') out.unshift(node.name);
  return out;
}

function readSqlTemplate(quasi: Node, bindings: Bindings, locals: Map<string, Node>, f: Facts) {
  let text = '';
  quasi.quasis.forEach((q: Node, i: number) => {
    text += q.value.raw;
    const expr = quasi.expressions[i];
    if (!expr) return;
    if (expr.type === 'CallExpression' && expr.callee.type === 'MemberExpression' && expr.callee.property.name === 'table') {
      text += strings(expr.arguments[0], bindings, locals)[0] ?? '?';
    } else text += ' $ ';
  });
  for (const m of text.matchAll(/\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi)) addTable(f, m[1]!, 'insert');
  for (const m of text.matchAll(/\bUPDATE\s+([a-z_][a-z0-9_]*)/gi)) addTable(f, m[1]!, 'update');
  for (const m of text.matchAll(/\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)/gi)) addTable(f, m[1]!, 'delete');
  for (const m of text.matchAll(/\b(FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) {
    if (/DELETE\s+$/i.test(text.slice(Math.max(0, m.index! - 10), m.index))) continue;
    addTable(f, m[2]!, 'read');
  }
}

function serializeFacts(f: Facts) {
  const tables: Record<string, Op[]> = {};
  for (const [t, ops] of [...f.tables].sort(([a], [b]) => a.localeCompare(b))) tables[t] = [...ops].sort();
  return {
    tables,
    events: [...f.events].sort(),
    searchSync: [...f.searchSync].sort(),
    audits: [...f.audits].sort(),
    errors: [...f.errors.values()].sort((a, b) => a.status - b.status || a.code.localeCompare(b.code)),
    notifications: [...f.notifications].sort(),
    providers: [...f.providers].sort(),
  };
}

// ---------------------------------------------------------------- the route tree (static)

interface StaticRoute {
  method: string;
  url: string;
  file: string;
  moduleFile: string;
  line: number;
  doc: string | null;
  section: string | null;
  plugin: string;
  guards: string[];
  handlerCalls: string[];
  facts: ReturnType<typeof serializeFacts>;
  statuses: number[];
  rateLimitSource: string | null;
}

const staticRoutes: StaticRoute[] = [];
const plugins: { name: string; file: string; line: number; prefix: string; guards: string[]; doc: string | null }[] = [];
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface Ctx {
  file: SourceFile;
  prefix: string;
  guards: string[];
  bindings: Bindings;
  plugin: string;
  /** The routes file a route belongs to: lifecycleRoutes() lives in content.ts but serves the file that registers it. */
  moduleFile: SourceFile;
}

function walkPlugin(body: Node, ctx: Ctx) {
  scopeStack.push({ file: ctx.file, fns: nestedFns(body) });
  const visit = (n: Node, c: Ctx): void => {
    currentFile = c.file;
    if (n.type === 'ForOfStatement') {
      // for (const path of ['/p/:id', …]) or for (const thread of threads) over a file-level array.
      let list = n.right;
      if (list.type === 'Identifier') list = c.file.decls.get(list.name)?.node;
      while (list && (list.type === 'TSAsExpression' || list.type === 'TSSatisfiesExpression')) list = list.expression;
      const id = n.left.declarations?.[0]?.id;
      if (list?.type === 'ArrayExpression' && id?.type === 'Identifier') {
        for (const el of list.elements) {
          if (el.type === 'ObjectExpression') {
            const extra: Bindings = {};
            for (const p of el.properties) {
              const v = p.type === 'Property' ? strings(p.value, c.bindings) : [];
              if (v.length === 1) extra[`${id.name}.${p.key.name ?? p.key.value}`] = v[0]!;
            }
            visit(n.body, { ...c, bindings: { ...c.bindings, ...extra } });
          } else {
            for (const v of strings(el, c.bindings)) visit(n.body, { ...c, bindings: { ...c.bindings, [id.name]: v } });
          }
        }
        return;
      }
    }
    if (isFn(n) && n !== body) return; // nested functions are reached through register()

    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed) {
      const method = n.callee.property.name;
      if (HTTP.has(method) && n.arguments.length >= 2) {
        const local = strings(n.arguments[0], c.bindings);
        const handler = n.arguments[n.arguments.length - 1];
        if (local.length === 1 && isFn(handler)) {
          recordRoute(method.toUpperCase(), c.prefix + local[0], n, handler, c);
          return;
        }
      }
      if (method === 'addHook' && strings(n.arguments[0], c.bindings)[0] === 'onRequest') {
        const h = n.arguments[1];
        if (h.type === 'Identifier') c.guards.push(h.name);
        if (h.type === 'CallExpression' && h.callee.type === 'Identifier') {
          c.guards.push(`${h.callee.name}(${strings(h.arguments[0], c.bindings)[0] ?? ''})`);
        }
        return;
      }
      if (method === 'register') {
        const arg = n.arguments[0];
        const extra = strings(prop(n.arguments[1], 'prefix'), c.bindings)[0] ?? '';
        const child: Ctx = { ...c, prefix: c.prefix + extra, guards: [...c.guards] };
        if (isFn(arg)) {
          walkPlugin(arg.body, child);
        } else if (arg.type === 'Identifier') {
          const target = lookup(c.file, arg.name);
          if (target && isFn(target.node)) {
            plugins.push({
              name: arg.name,
              file: target.file.rel,
              line: lineOf(target.file, target.stmtStart),
              prefix: child.prefix || '/',
              guards: child.guards,
              doc: docAbove(target.file, target.stmtStart),
            });
            walkPlugin(target.node.body, { ...child, file: target.file, moduleFile: target.file, bindings: {}, plugin: arg.name });
          }
        } else if (arg.type === 'CallExpression') {
          const target = resolveCallee(c.file, arg.callee);
          if (target && isFn(target.node)) {
            const bindings: Bindings = {};
            target.node.params.forEach((p: Node, i: number) => {
              const v = strings(arg.arguments[i], c.bindings);
              if (p.type === 'Identifier' && v.length === 1) bindings[p.name] = v[0]!;
            });
            let returned: Node = null;
            walk(target.node.body, (m) => {
              if (returned) return false;
              if (m.type === 'ReturnStatement' && isFn(m.argument)) returned = m.argument;
            });
            if (returned) {
              const label = `${target.name}(${Object.values(bindings).map((v) => `'${v}'`).join(', ')})`;
              walkPlugin((returned as Node).body, { ...child, file: target.file, bindings, plugin: label });
            }
          }
        }
        return;
      }
    }
    for (const ch of children(n)) visit(ch, c);
  };
  visit(body, ctx);
  scopeStack.pop();
}

/** A route's own comment, and the `// ----- Section -----` divider it sits under, if any. */
function docAndSection(file: SourceFile, offset: number) {
  const dividers = [...file.src.slice(0, offset).matchAll(/\/\/\s*-{3,}\s*(.+?)\s*-{3,}/g)];
  const section = dividers.length ? dividers[dividers.length - 1]![1]! : null;
  let doc = docAbove(file, offset);
  if (doc) doc = doc.replace(/-{3,}\s*.+?\s*-{3,}/, '').trim() || null;
  return { doc, section };
}

function recordRoute(method: string, url: string, call: Node, handler: Node, c: Ctx) {
  const facts = analyzeBody(c.file, handler, c.bindings, null);
  const opts = call.arguments.length >= 3 ? call.arguments[1] : null;
  const config = prop(opts, 'config');
  // Find the statement start for the doc comment (the call is the expression statement).
  staticRoutes.push({
    method,
    url: url.replace(/\/+$/, '') || '/',
    file: c.file.rel,
    moduleFile: c.moduleFile.rel,
    line: lineOf(c.file, call.start),
    ...docAndSection(c.file, call.start),
    plugin: c.plugin,
    guards: [...c.guards],
    handlerCalls: facts.calls,
    facts: serializeFacts(facts),
    statuses: [...facts.statuses].sort(),
    rateLimitSource: config ? c.file.src.slice(config.start, config.end) : null,
  });
}

const appFile = load(path.join(SRC, 'app.ts'));
const buildAppFn = appFile.decls.get('buildApp')!.node;
walkPlugin(buildAppFn.body, { file: appFile, moduleFile: appFile, prefix: '', guards: [], bindings: {}, plugin: 'buildApp' });

// ---------------------------------------------------------------- runtime capture

interface RuntimeRoute {
  method: string;
  url: string;
  schema: Record<string, unknown>;
  rateLimit: { max: number; timeWindow: string; per: 'ip' | 'user' } | null;
  hidden: boolean;
}
const runtime: RuntimeRoute[] = [];
const apiRequire = createRequire(path.join(API, 'package.json'));
const zod = (await import(pathToFileURL(apiRequire.resolve('zod')).href)) as { toJSONSchema: (s: unknown, o?: unknown) => any };

function toJson(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null;
  try {
    return zod.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  } catch (error) {
    return { note: `not convertible: ${(error as Error).message}` };
  }
}

dc.subscribe('fastify.initialization', (message: any) => {
  message.fastify.addHook('onRoute', (r: any) => {
    const methods = [r.method].flat() as string[];
    for (const method of methods) {
      if (method === 'HEAD' && r.url !== '*') continue; // Fastify adds HEAD next to every GET
      const schema: Record<string, unknown> = {};
      for (const part of ['params', 'querystring', 'body']) if (r.schema?.[part]) schema[part] = toJson(r.schema[part]);
      const rl = r.config?.rateLimit;
      runtime.push({
        method,
        url: r.url,
        schema,
        rateLimit: rl ? { max: rl.max, timeWindow: rl.timeWindow, per: rl.keyGenerator ? 'user' : 'ip' } : null,
        hidden: Boolean(r.schema?.hide),
      });
    }
  });
});

process.env.NODE_ENV = process.env.NODE_ENV === 'test' ? 'development' : process.env.NODE_ENV;
const { buildApp } = (await import(pathToFileURL(path.join(SRC, 'app.ts')).href)) as { buildApp: () => Promise<any> };
const app = await buildApp();
await app.ready();
await app.close();

// ---------------------------------------------------------------- merge and check

const key = (m: string, u: string) => `${m} ${u}`;
const staticByKey = new Map(staticRoutes.map((r) => [key(r.method, r.url), r]));
const runtimeByKey = new Map(runtime.map((r) => [key(r.method, r.url), r]));
const onlyRuntime = runtime.filter((r) => !staticByKey.has(key(r.method, r.url)) && !(r.method === 'OPTIONS' && r.url === '*'));
const onlyStatic = staticRoutes.filter((r) => !runtimeByKey.has(key(r.method, r.url)));

function moduleOf(file: string, url: string): string {
  const m = file.match(/modules\/([^/]+)\/([^/]+)\.routes\.ts$/);
  if (!m) return url.startsWith('/media/public') ? 'storage' : 'core';
  if (m[1] === 'admin') return `admin.${m[2]}`;
  if (m[2] === 'storage') return 'storage';
  return m[1]!;
}

function accessOf(guards: string[], url: string): string {
  if (guards.some((g) => g.startsWith('requireRole(admin'))) return 'admin';
  if (guards.some((g) => g.startsWith('requireRole(moderator'))) return 'moderator';
  if (guards.includes('authenticate')) return 'user';
  if (url.startsWith('/storage/') || url.startsWith('/media/')) return 'token';
  return 'public';
}

const routes = [
  ...staticRoutes.map((s) => ({ s, r: runtimeByKey.get(key(s.method, s.url)) ?? null })),
  ...onlyRuntime.map((r) => ({ s: null as StaticRoute | null, r })),
].map(({ s, r }, i) => {
  const method = (s?.method ?? r!.method) as string;
  const url = (s?.url ?? r!.url) as string;
  const file = s?.file ?? rel(path.join(SRC, 'modules', 'media', 'storage.routes.ts'));
  const success = s?.statuses.filter((c) => c < 400) ?? [];
  return {
    id: `r${i}`,
    method,
    url,
    module: moduleOf(s?.moduleFile ?? file, url),
    access: accessOf(s?.guards ?? [], url),
    guards: s?.guards ?? [],
    plugin: s?.plugin ?? '@fastify/static',
    file,
    line: s?.line ?? null,
    section: s?.section ?? null,
    doc: s?.doc ?? (s ? null : 'Public files (avatars, learn media, paper figures), served by @fastify/static with a one-year immutable cache.'),
    success: success.length ? success : [200],
    rateLimit: r?.rateLimit ?? null,
    schema: r?.schema ?? {},
    handlerCalls: s?.handlerCalls ?? [],
    facts: s?.facts ?? serializeFacts(emptyFacts()),
    staticOnly: !r,
    runtimeOnly: !s,
  };
});

// ---------------------------------------------------------------- worker

const workerFile = load(path.join(SRC, 'worker.ts'));
const loops: any[] = [];
walk(workerFile.ast, (n) => {
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'loop' && n.arguments.length === 3) {
    const name = strings(n.arguments[0], {})[0];
    const fn = n.arguments[1];
    if (!name || !isFn(fn)) return;
    const facts = analyzeBody(workerFile, fn, {}, null);
    loops.push({ name, idleMs: number(n.arguments[2]), line: lineOf(workerFile, n.start), doc: docAbove(workerFile, n.start), entry: facts.calls, facts: serializeFacts(facts) });
  }
});

const outboxWorker = load(path.join(SRC, 'worker', 'outbox.ts'));
const handlersNode = outboxWorker.decls.get('handlers')?.node;
const eventHandlers: any[] = [];
for (const p of handlersNode?.properties ?? []) {
  const event = p.key.value ?? p.key.name;
  if (!isFn(p.value)) continue;
  const facts = analyzeBody(outboxWorker, p.value, {}, null);
  eventHandlers.push({ event, line: lineOf(outboxWorker, p.start), doc: docAbove(outboxWorker, p.start), calls: facts.calls, facts: serializeFacts(facts) });
}

// The event catalogue with each event's documentation, from lib/outbox.ts.
const outboxLib = load(path.join(SRC, 'lib', 'outbox.ts'));
const eventDocs: Record<string, { doc: string | null; payload: string; entity: string | null }> = {};
const entityNode = outboxLib.decls.get('ENTITY_TYPES')?.node;
walk(outboxLib.ast, (n) => {
  if (n.type === 'TSInterfaceDeclaration' && n.id.name === 'OutboxEvents') {
    for (const m of n.body.body) {
      const name = m.key.value ?? m.key.name;
      const typeNode = m.typeAnnotation?.typeAnnotation;
      eventDocs[name] = {
        doc: docAbove(outboxLib, m.start),
        payload: typeNode ? outboxLib.src.slice(typeNode.start, typeNode.end).replace(/\s+/g, ' ') : '',
        entity: strings(prop(entityNode, name), {})[0] ?? (name === 'search.sync' ? 'varies' : null),
      };
    }
  }
});

// ---------------------------------------------------------------- configuration and providers

const envFile = load(path.join(SRC, 'config', 'env.ts'));
const envVars: any[] = [];
let biggest: Node = null;
walk(envFile.ast, (n) => {
  if (n.type === 'ObjectExpression' && (!biggest || n.properties.length > biggest.properties.length)) biggest = n;
});
for (const p of (biggest as Node)?.properties ?? []) {
  if (p.type !== 'Property') continue;
  const valueText = envFile.src.slice(p.value.start, p.value.end).replace(/\s+/g, ' ');
  const lineEnd = envFile.src.indexOf('\n', p.end);
  const trailing = envFile.src.slice(p.end, lineEnd).match(/\/\/\s?(.*)$/)?.[1] ?? null;
  const def = valueText.match(/\.default\(([^)]*)\)/)?.[1]?.trim() ?? null;
  envVars.push({
    name: p.key.name ?? p.key.value,
    rule: valueText.length > 180 ? `${valueText.slice(0, 177)}…` : valueText,
    default: def,
    optional: /\.optional\(\)|\.nullish\(\)/.test(valueText),
    doc: docAbove(envFile, p.start) ?? trailing,
    line: lineOf(envFile, p.start),
  });
}

const providerFile = load(path.join(SRC, 'providers', 'index.ts'));
const providerIfaces: any[] = [];
for (const stmt of providerFile.ast.body) {
  const n = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
  if (n?.type !== 'TSInterfaceDeclaration') continue;
  const methods = n.body.body.filter((m: Node) => m.type === 'TSMethodSignature' || m.typeAnnotation?.typeAnnotation?.type === 'TSFunctionType');
  if (!methods.length) continue; // message shapes, not services
  providerIfaces.push({ name: n.id.name, line: lineOf(providerFile, stmt.start), doc: docAbove(providerFile, stmt.start), methods: methods.map((m: Node) => m.key.name) });
}
const scholarlyFile = load(path.join(SRC, 'providers', 'scholarly.ts'));
for (const stmt of scholarlyFile.ast.body) {
  const n = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
  if (n?.type !== 'TSInterfaceDeclaration' || n.id.name !== 'ScholarlySources') continue;
  providerIfaces.push({ name: n.id.name, file: scholarlyFile.rel, line: lineOf(scholarlyFile, stmt.start), doc: docAbove(scholarlyFile, stmt.start), methods: n.body.body.map((m: Node) => m.key?.name).filter(Boolean) });
}

// Global error responses, from lib/error-handler.ts.
const handlerFile = load(path.join(SRC, 'lib', 'error-handler.ts'));
const globalErrors: any[] = [];
walk(handlerFile.ast, (n) => {
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && (n.callee.name === 'send' || n.callee.name === 'sendError')) {
    const offset = n.callee.name === 'sendError' ? 1 : 0;
    const status = number(n.arguments[offset]);
    const code = strings(n.arguments[offset + 1], {})[0];
    if (status && code) globalErrors.push({ status, code, message: strings(n.arguments[offset + 2], {})[0] ?? '', line: lineOf(handlerFile, n.start) });
  }
});

// What the onRequest guards themselves check and read (authenticate, requireRole(…)).
const authFile = load(path.join(SRC, 'lib', 'auth.ts'));
const guards: Record<string, ReturnType<typeof serializeFacts> & { file: string; line: number; doc: string | null }> = {};
for (const g of new Set(staticRoutes.flatMap((r) => r.guards))) {
  const m = g.match(/^(\w+)(?:\((\w*)\))?$/);
  const target = m ? lookup(authFile, m[1]!) : null;
  if (!target || !isFn(target.node)) continue;
  let fn = target.node;
  const bindings: Bindings = {};
  if (m![2] !== undefined) {
    // requireRole('admin') returns the hook: analyse that, with `minimum` bound.
    const param = fn.params[0];
    if (param?.type === 'Identifier') bindings[param.name] = m![2]!;
    walk(fn.body, (n) => {
      if (n.type === 'ReturnStatement' && isFn(n.argument)) fn = n.argument;
    });
  }
  // Both branches of `minimum === 'admin' ? … : …` are read; keep only the message for this role.
  const facts = serializeFacts(analyzeBody(target.file, fn, bindings, null));
  if (m![2]) facts.errors = facts.errors.filter((e) => e.code !== 'FORBIDDEN' || e.message.toLowerCase().startsWith(m![2]!));
  guards[g] = { ...facts, file: target.file.rel, line: lineOf(target.file, target.stmtStart), doc: docAbove(target.file, target.stmtStart) };
}

// Which schema-guide area each table belongs to (for colour and links).
let areas: any[] = [];
const schemaGuide = path.join(ROOT, '.schema-guide', 'guide.json');
if (existsSync(schemaGuide)) areas = JSON.parse(readFileSync(schemaGuide, 'utf8')).areas.map((a: any) => ({ id: a.id, name: a.name, tables: a.tables }));

// ---------------------------------------------------------------- write

// Only the functions some route or worker path reaches, with their own (not inherited) facts.
const facts = {
  version: 1,
  readAt: new Date().toISOString(),
  source: { app: 'apps/api/src/app.ts', worker: 'apps/api/src/worker.ts' },
  check: {
    routesRuntime: runtime.filter((r) => !(r.method === 'OPTIONS' && r.url === '*')).length,
    routesStatic: staticRoutes.length,
    onlyRuntime: onlyRuntime.map((r) => key(r.method, r.url)),
    onlyStatic: onlyStatic.map((r) => key(r.method, r.url)),
  },
  tables: [...TABLES].sort(),
  areas,
  plugins,
  guards,
  routes,
  functions: [...functions.values()].sort((a, b) => a.id.localeCompare(b.id)),
  events: Object.entries(eventDocs).map(([name, d]) => ({ name, ...d })),
  eventHandlers,
  loops,
  env: envVars,
  providers: providerIfaces,
  globalErrors,
};

writeFileSync(path.join(HERE, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
console.log(
  `facts.json: ${routes.length} routes (${facts.check.routesRuntime} registered, ${facts.check.routesStatic} found in source), ` +
    `${facts.functions.length} functions, ${eventHandlers.length} event handlers, ${loops.length} worker loops, ${envVars.length} env vars`,
);
if (onlyRuntime.length) console.log(`  registered but not found in source: ${facts.check.onlyRuntime.join(', ')}`);
if (onlyStatic.length) console.log(`  found in source but not registered: ${facts.check.onlyStatic.join(', ')}`);
process.exit(0);
