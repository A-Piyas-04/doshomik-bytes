import os from 'node:os';
import path from 'node:path';

/** Environment for the test run. Tests use their own database, which is wiped on every run. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5432/doshomik_test',
  APP_SECRET: 'test-only-secret-at-least-32-characters-long',
  MEDIA_DIR: path.join(os.tmpdir(), 'doshomik-test-media'),
  DEV_MAIL_DIR: path.join(os.tmpdir(), 'doshomik-test-mail'),
  GOOGLE_CLIENT_IDS: 'test-client-id',
};
