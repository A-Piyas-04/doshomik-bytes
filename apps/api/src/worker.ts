// The background worker: `pnpm worker`. Runs next to the API and does everything slow, so user
// requests never wait on it: media processing, outbox events (counters, notifications, push,
// email), paper ingestion from scholarly sources, and hourly maintenance.

import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import pino from 'pino';
import { env } from './config/env';
import { db } from './db';
import { runMaintenance } from './worker/maintenance';
import { processNextMedia } from './worker/media';
import { processOutboxBatch } from './worker/outbox';
import { runPaperSync } from './worker/papers';

const log = pino({ name: 'worker' });

// One worker at a time. Running several needs a lease column on outbox_events and media_assets
// (docs/prototype-2-implementation-notes.md); until then this advisory lock keeps a second copy out.
const WORKER_LOCK_ID = 7_302_514;
const lock = new pg.Client({ connectionString: env.DATABASE_URL });
await lock.connect();
const { rows } = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [WORKER_LOCK_ID]);
if (!rows[0]?.locked) {
  log.error('Another worker is already running');
  await lock.end();
  process.exit(1);
}

let running = true;

/** Repeats `work` until shutdown, sleeping `idleMs` whenever it found nothing to do. */
async function loop(name: string, work: () => Promise<boolean>, idleMs: number): Promise<void> {
  while (running) {
    let busy = false;
    try {
      busy = await work();
    } catch (error) {
      log.error({ err: error, loop: name }, 'Worker loop failed');
    }
    if (!busy && running) await sleep(idleMs);
  }
}

// Media gets its own loop so a long transcode doesn't hold up notifications.
const loops = Promise.all([
  loop('media', () => processNextMedia(log), 2_000),
  loop('outbox', async () => (await processOutboxBatch(log)) > 0, 1_000),
  // Paper ingestion has its own loop too: outside APIs are slow and rate limited.
  loop('papers', () => runPaperSync(log), 60_000),
  loop('maintenance', async () => (await runMaintenance(log), false), 60 * 60_000),
]);
log.info('Worker started');

async function shutdown(signal: string) {
  log.info(`${signal} received, finishing current work`);
  running = false;
  await loops;
  await lock.end(); // releases the advisory lock
  await db.destroy();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
