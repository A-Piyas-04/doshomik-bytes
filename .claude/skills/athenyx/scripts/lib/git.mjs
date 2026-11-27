// Read-only git queries. Every function degrades gracefully when git or the repo is missing.
import { execFileSync } from 'node:child_process';
import { normPath } from './util.mjs';

/** Athenyx's own folders never count as project changes. */
const OWN = /^(\.athenyx|athenyx-reports)(\/|$)/;

function git(root, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
  } catch {
    return null;
  }
}

/** Top-level folder of the repository containing `dir`, or null outside git. */
export const repoRoot = (dir) => git(dir, ['rev-parse', '--show-toplevel']);

/** { isRepo, branch, sha, shortSha, dirtyFiles[] } — sha is null in a fresh repo or without git. */
export function gitInfo(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!inside) return { isRepo: false, branch: null, sha: null, shortSha: null, dirtyFiles: [] };
  const sha = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? '';
  const dirtyFiles = [];
  const parts = status.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const code = entry.slice(0, 2);
    const path = normPath(entry.slice(3));
    if (!OWN.test(path)) dirtyFiles.push({ code: code.trim() || code, path });
    if (code.startsWith('R') || code.startsWith('C')) i += 1; // rename: next part is the old path
  }
  return {
    isRepo: true,
    branch: branch && branch !== 'HEAD' ? branch : null,
    sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null,
    shortSha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : null,
    dirtyFiles,
  };
}

export const commitExists = (root, ref) => Boolean(ref) && git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

/** A sensible "changes since" base: merge-base with the default branch, else HEAD~1. */
export function defaultBase(root) {
  const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (candidate === current || !commitExists(root, candidate)) continue;
    const mb = git(root, ['merge-base', 'HEAD', candidate]);
    const head = git(root, ['rev-parse', 'HEAD']);
    if (mb && mb !== head) return mb;
  }
  return commitExists(root, 'HEAD~1') ? git(root, ['rev-parse', 'HEAD~1']) : null;
}

/**
 * Working tree vs `base`: changed paths with status and the unified diff
 * (committed + staged + unstaged). Untracked files are reported as added.
 */
export function diffSince(root, base) {
  const changes = [];
  const nameStatus = base ? git(root, ['diff', '--name-status', '-M', base]) : null;
  for (const line of (nameStatus ?? '').split('\n').filter(Boolean)) {
    const [status, a, b] = line.split('\t');
    if (!OWN.test(normPath(b ?? a))) changes.push({ status: status[0], path: normPath(b ?? a), oldPath: b ? normPath(a) : null });
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']) ?? '';
  for (const p of untracked.split('\n').filter((x) => x && !OWN.test(normPath(x)))) {
    if (!changes.some((c) => c.path === normPath(p))) changes.push({ status: 'A', path: normPath(p), oldPath: null, untracked: true });
  }
  const patch = base ? (git(root, ['diff', '--unified=3', '-M', base]) ?? '') : '';
  return { changes, patch };
}

/** New-file line ranges touched by each file's hunks: { path: [[start, end], …] }. */
export function hunkRanges(patch) {
  const out = {};
  let current = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '');
      current = p === '/dev/null' ? null : normPath(p);
      if (current) out[current] ??= [];
    } else if (current && line.startsWith('@@')) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const len = m[2] === undefined ? 1 : Number(m[2]);
        out[current].push([start, Math.max(start, start + len - 1)]);
      }
    }
  }
  return out;
}
