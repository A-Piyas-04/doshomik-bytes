import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { TEST_ENV } from './env';

/** Creates the test database if needed, wipes it, and runs every migration. */
export default async function setup() {
  const url = new URL(TEST_ENV.DATABASE_URL);
  const databaseName = url.pathname.slice(1);

  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }

  await runner({
    databaseUrl: TEST_ENV.DATABASE_URL,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}
