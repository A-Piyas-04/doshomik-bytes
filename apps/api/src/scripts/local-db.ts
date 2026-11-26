/**
 * The local development database, with no password and no role setup.
 *
 * This runs its own PostgreSQL cluster on port 55433, created with `trust`
 * authentication: it accepts any local connection without a password, so there
 * is no role or password to configure, ever. It is completely separate from any
 * PostgreSQL service installed on this machine and never touches it.
 *
 *   pnpm db:up      start it (creating and migrating it the first time)
 *   pnpm db:down    stop it
 *   pnpm db:status  is it running?
 *   pnpm db:reset   throw it away and build it again from the migrations
 *
 * It is still real PostgreSQL, so the schema, the full-text search and the
 * migrations behave exactly as they will on the VPS or on Supabase.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Where the PostgreSQL binaries are. Override with PG_BIN if they move. */
const PG_BIN = process.env.PG_BIN ?? 'E:\\PostgreSQL\\bin';
/**
 * The cluster's files. Kept outside the repo on purpose: Metro watches the
 * repo and must not see a database writing to its log on every query.
 */
const PG_DATA = process.env.LOCAL_PG_DATA ?? 'E:\\Projects\\doshomik-dev-data';
const PORT = process.env.LOCAL_PG_PORT ?? '55433';
const USER = 'dev';
const DATABASES = ['doshomik', 'doshomik_test'];

const tool = (name: string) => path.join(PG_BIN, `${name}.exe`);
const logFile = path.join(PG_DATA, 'server.log');

async function pgCtl(...args: string[]) {
  return run(tool('pg_ctl'), ['-D', PG_DATA, ...args], { windowsHide: true });
}

async function isRunning() {
  try {
    await pgCtl('status');
    return true;
  } catch {
    return false;
  }
}

async function initCluster() {
  if (fs.existsSync(path.join(PG_DATA, 'PG_VERSION'))) return false;

  if (!fs.existsSync(tool('initdb'))) {
    throw new Error(
      `PostgreSQL binaries not found at ${PG_BIN}. Set PG_BIN to the folder holding initdb.exe.`,
    );
  }

  console.log(`Creating the development cluster in ${PG_DATA} (no password needed)…`);
  fs.mkdirSync(PG_DATA, { recursive: true });
  // --auth=trust is what removes passwords. Safe here: the cluster listens on
  // localhost only, holds development data only, and is never deployed.
  await run(
    tool('initdb'),
    ['-D', PG_DATA, '-U', USER, '--auth=trust', '--encoding=UTF8', '--locale=C'],
    { windowsHide: true },
  );
  return true;
}

async function start() {
  if (await isRunning()) return;
  console.log(`Starting PostgreSQL on port ${PORT}…`);
  await pgCtl('-o', `-p ${PORT} -c listen_addresses=localhost`, '-l', logFile, '-w', 'start');
}

async function createDatabases() {
  const { stdout } = await run(
    tool('psql'),
    ['-h', 'localhost', '-p', PORT, '-U', USER, '-d', 'postgres', '-At', '-c',
      'SELECT datname FROM pg_database'],
    { windowsHide: true },
  );
  const existing = new Set(stdout.split(/\r?\n/).map((line) => line.trim()));

  for (const name of DATABASES) {
    if (existing.has(name)) continue;
    console.log(`Creating database ${name}…`);
    await run(tool('createdb'), ['-h', 'localhost', '-p', PORT, '-U', USER, name], {
      windowsHide: true,
    });
  }
}

async function main() {
  const command = process.argv[2] ?? 'up';

  switch (command) {
    case 'up': {
      const created = await initCluster();
      await start();
      await createDatabases();
      console.log(`\nDatabase ready on port ${PORT}. No password, no role setup.`);
      if (created) console.log('Next: pnpm db:migrate && pnpm db:seed');
      break;
    }

    case 'down': {
      if (!(await isRunning())) {
        console.log('Already stopped.');
        break;
      }
      await pgCtl('-m', 'fast', '-w', 'stop');
      console.log('Stopped.');
      break;
    }

    case 'status': {
      console.log((await isRunning()) ? `Running on port ${PORT}.` : 'Stopped.');
      break;
    }

    case 'reset': {
      if (await isRunning()) await pgCtl('-m', 'immediate', '-w', 'stop');
      console.log(`Deleting ${PG_DATA}…`);
      fs.rmSync(PG_DATA, { recursive: true, force: true });
      await initCluster();
      await start();
      await createDatabases();
      console.log('\nEmpty database ready. Next: pnpm db:migrate && pnpm db:seed');
      break;
    }

    default:
      console.error(`Unknown command "${command}". Use up, down, status or reset.`);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\nIf the server failed to start, its log is at ${logFile}`);
  process.exit(1);
});
