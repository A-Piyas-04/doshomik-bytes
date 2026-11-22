import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../config/env';
import type { DB } from './types';

// Ids and counts are bigint in Postgres; at this scale they fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      connectionString: env.DATABASE_URL,
      // A runaway query fails fast instead of holding a connection.
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    }),
  }),
});

/** The shared database handle or an open transaction; services accept either. */
export type Db = Kysely<DB>;
