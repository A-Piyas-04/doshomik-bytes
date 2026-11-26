// One command: read the backend (extract.mts, run with tsx from apps/api so its packages and .env
// resolve), then write docs/api-guide.html (build.mjs).   Usage: node .api-guide/run.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(HERE, '..', 'apps', 'api');
const shell = process.platform === 'win32';

const extract = spawnSync('pnpm', ['exec', 'tsx', '--env-file-if-exists=.env', path.join(HERE, 'extract.mts')], {
  cwd: API,
  shell,
  encoding: 'utf8',
  env: { ...process.env, LOG_LEVEL: 'silent' },
});
// The app's logger prints JSON lines while it boots; show only our own output.
const keep = (s) => s.split('\n').filter((l) => l.trim() && !l.startsWith('{"level"')).join('\n');
if (keep(extract.stdout)) console.log(keep(extract.stdout));
if (extract.status !== 0) {
  console.error(keep(extract.stderr) || 'extract.mts failed');
  process.exit(extract.status ?? 1);
}

const build = spawnSync(process.execPath, [path.join(HERE, 'build.mjs')], { stdio: 'inherit' });
process.exit(build.status ?? 0);
