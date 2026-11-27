// `athenyx install <target>` — copies this self-contained skill folder where each AI tool looks for
// skills, and bakes the absolute CLI path into the copied SKILL.md. (The universal alternative is
// `npx skills add <owner>/<repo>`; marketplaces read the repo's own manifests.)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AthenyxError, VERSION } from './util.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = '.athenyx-install.json';

export const INSTALL_TARGETS = ['claude', 'agents', 'codex', 'cursor', 'copilot', 'antigravity', 'gemini', 'all'];

/** Where each target looks. `agents` (~/.agents/skills) is read by Codex, Cursor, Copilot, Gemini CLI and Devin/Windsurf. */
function destinations(target, project, cwd) {
  const home = homedir();
  const user = {
    claude: [{ kind: 'skill', dir: join(home, '.claude', 'skills', 'athenyx'), note: 'Claude Code → /athenyx' }],
    agents: [{ kind: 'skill', dir: join(home, '.agents', 'skills', 'athenyx'), note: 'Codex ($athenyx), Cursor, Copilot, Gemini CLI, Windsurf/Devin → /athenyx' }],
    antigravity: [{ kind: 'skill', dir: join(home, '.gemini', 'config', 'skills', 'athenyx'), note: 'Antigravity → /athenyx' }],
    gemini: [{ kind: 'command', file: join(home, '.gemini', 'commands', 'athenyx.toml'), note: 'Gemini CLI → /athenyx' }],
  };
  const proj = {
    claude: [{ kind: 'skill', dir: join(cwd, '.claude', 'skills', 'athenyx'), note: 'Claude Code (this project) → /athenyx' }],
    agents: [{ kind: 'skill', dir: join(cwd, '.agents', 'skills', 'athenyx'), note: 'Codex, Cursor, Copilot, Gemini CLI, Antigravity, Windsurf (this project)' }],
    antigravity: [{ kind: 'skill', dir: join(cwd, '.agents', 'skills', 'athenyx'), note: 'Antigravity (this project)' }],
    gemini: [{ kind: 'command', file: join(cwd, '.gemini', 'commands', 'athenyx.toml'), note: 'Gemini CLI (this project) → /athenyx' }],
  };
  const table = project ? proj : user;
  const alias = { codex: 'agents', cursor: 'agents', copilot: 'agents' }[target] ?? target;
  let picked;
  if (alias === 'all') {
    picked = [...table.claude, ...table.agents, ...table.antigravity];
    if (existsSync(join(project ? cwd : home, '.gemini'))) picked.push(...table.gemini.map((g) => ({ ...g, needsSkill: true })));
  } else if (alias === 'gemini') picked = [...table.agents, ...table.gemini];
  else picked = table[alias];
  if (!picked) throw new AthenyxError(`Unknown target "${target}". Use one of: ${INSTALL_TARGETS.join(', ')}.`);
  const seen = new Set();
  return picked.filter((d) => {
    const key = d.dir ?? d.file;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function copySkill(dir, force) {
  if (existsSync(dir) && !existsSync(join(dir, MARKER)) && !force) {
    throw new AthenyxError(`${dir} already exists and was not installed by Athenyx. Remove it or pass --force.`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(SKILL_DIR, dir, { recursive: true, filter: (src) => !src.includes(`${MARKER}`) });
  const skillFile = join(dir, 'SKILL.md');
  const target = dir.replaceAll('\\', '/');
  // The placeholder (fresh checkout) or the source copy's own baked path (installing from an install).
  const text = readFileSync(skillFile, 'utf8').split('${CLAUDE_SKILL_DIR}').join(target).split(SKILL_DIR.replaceAll('\\', '/')).join(target);
  writeFileSync(skillFile, text);
  writeFileSync(join(dir, MARKER), `${JSON.stringify({ version: VERSION, installedAt: new Date().toISOString(), source: SKILL_DIR }, null, 2)}\n`);
}

function writeGeminiCommand(file, skillDir) {
  mkdirSync(dirname(file), { recursive: true });
  const skill = join(skillDir, 'SKILL.md').replaceAll('\\', '/');
  writeFileSync(
    file,
    `description = "Athenyx review board: an evidence-checked review of this codebase, written as an HTML report."\nprompt = """\nRun an Athenyx review. Read and follow the instructions in ${skill} exactly.\nThe user's request (mode first, e.g. health, changes, ask "...", release): {{args}}\n"""\n`,
  );
}

export function install(positionals, flags) {
  const target = (positionals[0] ?? '').toLowerCase();
  if (!target) {
    console.log(`Usage: athenyx install <${INSTALL_TARGETS.join('|')}> [--project] [--path <dir>] [--dry-run] [--force]`);
    return;
  }
  const cwd = process.cwd();
  const custom = typeof flags.path === 'string' ? [{ kind: 'skill', dir: join(resolve(flags.path), 'athenyx'), note: 'custom path' }] : null;
  const plan = custom ?? destinations(target, Boolean(flags.project), cwd);
  const skillDirs = plan.filter((d) => d.kind === 'skill').map((d) => d.dir);
  const dry = Boolean(flags['dry-run']);
  for (const d of plan) {
    if (d.kind === 'skill') {
      if (!dry) copySkill(d.dir, Boolean(flags.force));
      console.log(`${dry ? '[dry run] would install' : 'installed'} skill → ${d.dir}   (${d.note})`);
    } else {
      const skillDir = skillDirs.find((x) => x.includes(`${'.agents'}`)) ?? skillDirs[0] ?? SKILL_DIR;
      if (!dry) writeGeminiCommand(d.file, skillDir);
      console.log(`${dry ? '[dry run] would write' : 'wrote'} command → ${d.file}   (${d.note})`);
    }
  }
  if (!dry) console.log('\nRestart or reload your AI tool, open a project, and type /athenyx (in Codex: $athenyx).');
}
