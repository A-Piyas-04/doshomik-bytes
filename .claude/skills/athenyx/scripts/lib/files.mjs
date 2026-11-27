// Which files Athenyx may read, and reading them.
// Rules ported from the web app (src/lib/repo/filters.ts, files.ts).
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, basename, join, resolve, sep } from 'node:path';
import { normPath } from './util.mjs';

export const MAX_FILE_BYTES = 200 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
/** Above this many readable files the hotspot scan samples (biggest risk first). */
export const MAX_SCANNED_FILES = 5000;

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.vercel', 'coverage',
  'vendor', '.cache', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', '.svelte-kit', '.output',
  '.parcel-cache', '.gradle', '.idea', '.vscode', '.athenyx', 'athenyx-reports', '.terraform', 'Pods',
]);
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'composer.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'go.sum']);
const IGNORED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.tiff', '.tif', '.psd', '.heic', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.oga', '.webm', '.mov', '.avi', '.mkv', '.flac', '.m4a',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.pdf', '.map', '.snap',
  '.exe', '.dll', '.so', '.dylib', '.class', '.pyc', '.wasm', '.db', '.sqlite', '.sqlite3',
]);
const SECRET_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks']);
const SECRET_NAMES = new Set(['.env', 'credentials.json', '.npmrc', '.netrc', '.pypirc', 'secrets.json', 'secrets.yaml', 'secrets.yml']);
const ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);

export function isSecretPath(p) {
  const base = basename(normPath(p)).toLowerCase();
  if (ENV_TEMPLATES.has(base)) return false;
  if (SECRET_NAMES.has(base) || base.startsWith('.env.')) return true;
  if (SECRET_EXT.has(extname(base))) return true;
  if (base.startsWith('id_rsa') || base.startsWith('id_ed25519')) return true;
  if (base.startsWith('service-account') && base.endsWith('.json')) return true;
  return false;
}

export function ignoredDirOf(p) {
  const parts = normPath(p).split('/');
  for (let i = 0; i < parts.length - 1; i += 1) if (IGNORED_DIRS.has(parts[i])) return parts.slice(0, i + 1).join('/');
  return null;
}

/** "ignored" | "secret" | null — path-only classification. */
export function classifyPath(p) {
  if (ignoredDirOf(p)) return 'ignored';
  if (isSecretPath(p)) return 'secret';
  const base = basename(normPath(p)).toLowerCase();
  if (LOCKFILES.has(basename(normPath(p))) || base.endsWith('.min.js') || base.endsWith('.min.css')) return 'ignored';
  if (IGNORED_EXT.has(extname(base))) return 'ignored';
  return null;
}

export function isTestPath(p) {
  const n = normPath(p);
  if (/\.(test|spec)\.[^./]+$/.test(basename(n))) return true;
  if (/(^|\/)test_[^/]+\.py$/.test(n) || /_test\.(go|py|rb)$/.test(n)) return true;
  return /(^|\/)(__tests__|tests?|e2e|spec)\//.test(n);
}

function looksBinary(abs) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const n = readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0);
    for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
    return false;
  } catch {
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function gitListFiles(root) {
  try {
    const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString('utf8').split('\0').filter(Boolean).map(normPath);
  } catch {
    return null;
  }
}

function walk(root) {
  const out = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) stack.push(p);
      } else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

/**
 * Lists readable files (git-tracked + untracked-not-ignored when in a git repo,
 * otherwise a filtered walk) and the excluded ones with a reason.
 */
export function listFiles(root) {
  const candidates = gitListFiles(root) ?? walk(root);
  const files = [];
  const excluded = [];
  const ignoredDirs = new Set();
  for (const p of candidates) {
    const byPath = classifyPath(p);
    if (byPath === 'ignored') {
      const dir = ignoredDirOf(p);
      if (dir) ignoredDirs.add(dir);
      else excluded.push({ path: p, reason: 'ignored' });
      continue;
    }
    if (byPath === 'secret') {
      excluded.push({ path: p, reason: 'secret' });
      continue;
    }
    const abs = join(root, p);
    let size;
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue; // deleted in the working tree
    }
    if (size > MAX_FILE_BYTES) excluded.push({ path: p, reason: 'too_large' });
    else if (looksBinary(abs)) excluded.push({ path: p, reason: 'binary' });
    else files.push({ path: p, size });
  }
  for (const dir of ignoredDirs) if (dir !== '.athenyx' && dir !== 'athenyx-reports') excluded.push({ path: `${dir}/`, reason: 'ignored' });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excluded };
}

/** Reads repository files with a cache; refuses paths outside the root or excluded by the rules. */
export function createReader(root) {
  const base = resolve(root);
  const cache = new Map();
  return {
    /** Returns the text or null (missing, binary, secret, ignored, too large, outside the root). */
    read(p) {
      const rel = normPath(p);
      if (cache.has(rel)) return cache.get(rel);
      let text = null;
      if (rel && !rel.split('/').includes('..') && classifyPath(rel) === null) {
        const abs = resolve(base, rel);
        if (abs === base || abs.startsWith(base + sep)) {
          try {
            const st = statSync(abs);
            if (st.isFile() && st.size <= MAX_FILE_BYTES && !looksBinary(abs)) text = readFileSync(abs, 'utf8');
          } catch {
            text = null;
          }
        }
      }
      cache.set(rel, text);
      return text;
    },
    lines(p) {
      const text = this.read(p);
      return text === null ? null : text.replace(/\r\n?/g, '\n').split('\n');
    },
  };
}
