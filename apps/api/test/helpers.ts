import type { UserRole } from '@doshomik/shared';
import { sql } from 'kysely';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { db } from '../src/db';
import { encrypt } from '../src/lib/crypto';
import { generateTotpSecret, totpCode } from '../src/lib/totp';
import { providers, type EmailMessage, type GoogleIdentity, type PushMessage } from '../src/providers';
import { processNextMedia } from '../src/worker/media';
import { processOutboxBatch } from '../src/worker/outbox';

export type App = Awaited<ReturnType<typeof buildApp>>;

export interface TestUser {
  /** Public id. */
  id: string;
  username: string;
  headers: { authorization: string };
  refreshToken: string;
  /** Set for staff created with two-factor on. */
  totpSecret?: string;
}

/** What the fake providers received during the current test. */
export const sent = { emails: [] as EmailMessage[], pushes: [] as { tokens: string[]; message: PushMessage }[] };
/** ID token → identity, for the fake Google verifier. */
export const googleAccounts = new Map<string, GoogleIdentity>();

const silent = pino({ level: 'silent' });

/** Builds the app once per file, and empties every table and fake before each test. */
export function useTestApp(): { app: App } {
  const context = {} as { app: App };

  beforeAll(async () => {
    providers.email = { send: async (message) => void sent.emails.push(message) };
    providers.push = { send: async (tokens, message) => void sent.pushes.push({ tokens, message }) };
    providers.google = {
      verify: async (idToken) => {
        const identity = googleAccounts.get(idToken);
        if (!identity) throw new Error('Invalid token');
        return identity;
      },
    };
    context.app = await buildApp();
  });

  beforeEach(async () => {
    const { rows } = await sql<{ tablename: string }>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`.execute(db);
    await sql`TRUNCATE ${sql.join(rows.map((r) => sql.table(r.tablename)))} RESTART IDENTITY CASCADE`.execute(db);
    sent.emails.length = 0;
    sent.pushes.length = 0;
    googleAccounts.clear();
  });

  afterAll(async () => {
    await context.app.close();
    await db.destroy();
  });

  return context;
}

/** Signs up a user. Staff roles get two-factor sign-in turned on, as staff routes require. */
export async function createUser(app: App, username: string, options: { role?: UserRole } = {}): Promise<TestUser> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: `${username}@example.com`, username, password: 'password123', platform: 'android' },
  });
  if (response.statusCode !== 201) throw new Error(`Sign-up failed: ${response.body}`);
  const { access_token, refresh_token, user } = response.json();

  let totpSecret: string | undefined;
  if (options.role && options.role !== 'user') {
    totpSecret = generateTotpSecret();
    await db
      .updateTable('users')
      .set({ role: options.role, totp_secret: encrypt('totp', totpSecret), totp_enabled_at: new Date() })
      .where('public_id', '=', user.id)
      .execute();
  }
  return { id: user.id, username, headers: { authorization: `Bearer ${access_token}` }, refreshToken: refresh_token, totpSecret };
}

export const currentCode = (secret: string) => totpCode(secret, Math.floor(Date.now() / 30_000));

/** Runs the worker until it has nothing left: media processing, then outbox events. */
export async function runWorker(): Promise<void> {
  for (let round = 0; round < 50; round++) {
    const media = await processNextMedia(silent);
    const events = await processOutboxBatch(silent);
    if (!media && events === 0) return;
  }
  throw new Error('Worker did not settle');
}

/** The three upload steps: ask for a slot, PUT the bytes to the signed URL, confirm. Returns the media id. */
export async function upload(
  app: App,
  user: TestUser,
  file: { kind: 'image' | 'video'; purpose: string; mimeType: string; bytes: Buffer },
): Promise<string> {
  const slot = await app.inject({
    method: 'POST',
    url: '/v1/media/uploads',
    headers: user.headers,
    payload: { kind: file.kind, purpose: file.purpose, mime_type: file.mimeType, size_bytes: file.bytes.length },
  });
  if (slot.statusCode !== 201) throw new Error(`Upload slot failed: ${slot.body}`);
  const { media, upload: target } = slot.json();

  const put = await app.inject({ method: 'PUT', url: new URL(target.url).pathname, headers: target.headers, payload: file.bytes });
  if (put.statusCode !== 200) throw new Error(`Upload failed: ${put.body}`);

  const complete = await app.inject({ method: 'POST', url: `/v1/media/${media.id}/complete`, headers: user.headers });
  if (complete.statusCode !== 200) throw new Error(`Complete failed: ${complete.body}`);
  return media.id;
}

/** The token from the last email's link (verification or password reset). */
export function tokenFromLastEmail(): string {
  const text = sent.emails.at(-1)?.text ?? '';
  const match = /token=([\w-]+)/.exec(text);
  if (!match) throw new Error('No token in the last email');
  return match[1]!;
}

/** Calls the API as `user` and returns status and JSON body. */
export async function call(app: App, user: TestUser | null, method: string, url: string, payload?: object) {
  const response = await app.inject({
    method: method as 'GET',
    url,
    headers: user?.headers,
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: response.statusCode, body: response.body ? response.json() : undefined };
}
