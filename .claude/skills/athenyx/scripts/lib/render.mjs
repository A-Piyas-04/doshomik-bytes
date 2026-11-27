// Writes the self-contained HTML report (never overwriting an earlier one) and the run index.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStamp } from './util.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const TOKEN = '__ATHENYX_DATA__';

/** JSON that is safe inside <script type="application/json">: no "</script>", no U+2028/9. */
export function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function fill(templateName, data) {
  const template = readFileSync(join(ASSETS, templateName), 'utf8');
  if (!template.includes(TOKEN)) throw new Error(`template ${templateName} has no data slot`);
  return template.split(TOKEN).join(embedJson(data));
}

/** athenyx-reports/athenyx-<mode>-YYYY-MM-DD_HH-mm-ss-<sha7>.html — a new file every run. */
export function reportFileName(reportsDir, mode, at, shortSha) {
  const base = `athenyx-${mode}-${fileStamp(new Date(at))}-${shortSha ?? 'nogit'}`;
  let name = `${base}.html`;
  for (let n = 2; existsSync(join(reportsDir, name)); n += 1) name = `${base}-${n}.html`;
  return name;
}

export function writeReport(reportsDir, fileName, data) {
  mkdirSync(reportsDir, { recursive: true });
  const file = join(reportsDir, fileName);
  writeFileSync(file, fill('report.html', data));
  return file;
}

/** athenyx-reports/index.html — every run, newest first. The only file Athenyx rewrites. */
export function writeIndex(reportsDir, { project, ledger }) {
  mkdirSync(reportsDir, { recursive: true });
  const runs = [...ledger.runs].reverse().map((r) => ({ ...r, exists: existsSync(join(reportsDir, r.file)) }));
  const counts = {};
  for (const f of ledger.findings) counts[f.status] = (counts[f.status] ?? 0) + 1;
  const file = join(reportsDir, 'index.html');
  writeFileSync(file, fill('index.html', { project, runs, counts, decisions: ledger.decisions.length, generatedAt: new Date().toISOString() }));
  return file;
}

/** Opens a file in the default browser; never fails the command. */
export function openInBrowser(file) {
  if (process.env.ATHENYX_NO_OPEN || process.env.CI) return false;
  try {
    const [cmd, args] =
      process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export const displayPath = (root, file) => relative(root, file).replaceAll('\\', '/');
