import { randomUUID } from 'node:crypto';
import type { Platform } from '@doshomik/shared';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { env } from '../../config/env';
import { db, type Db } from '../../db';
import { isPgError, PgError } from '../../db/errors';
import type { AccessClaims } from '../../lib/auth';
import { decrypt, hashToken, randomToken, signToken, verifyToken } from '../../lib/crypto';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../../lib/errors';
import { emit, emitSearchSync } from '../../lib/outbox';
import { verifyTotp } from '../../lib/totp';
import { providers } from '../../providers';
import { getAccount } from '../users/users.service';
import { loginThrottle } from './login-throttle';

export type TokenSigner = (claims: AccessClaims) => string;
export interface Device {
  platform: Platform;
  app_version?: string | null;
}

/** What a successful sign-in returns. `refresh_token` is "<session id>.<secret>"; only the secret's hash is stored. */
export interface SignedIn {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: Awaited<ReturnType<typeof getAccount>>;
}

/** Returned instead of tokens when the account has two-factor sign-in: finish with `completeMfaLogin`. */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
}

const MFA_TOKEN_TTL_MS = 5 * 60_000;

// ---------- Sign-up and sign-in ----------

export async function signup(
  input: { email: string; username: string; password: string } & Device,
  sign: TokenSigner,
): Promise<SignedIn> {
  const passwordHash = await argon2.hash(input.password);
  const userId = await db.transaction().execute(async (trx) => {
    const { id } = await insertUser(trx, { email: input.email, username: input.username, password_hash: passwordHash });
    await emit(trx, 'email.verify', id, {});
    return id;
  });
  return startSession(userId, input, sign);
}

/** Email or username plus password. Every failure looks the same, so it can't reveal which accounts exist. */
export async function login(input: { login: string; password: string } & Device, sign: TokenSigner): Promise<SignedIn | MfaChallenge> {
  const throttleKey = `login:${input.login}`;
  loginThrottle.check(throttleKey);

  const user = await db
    .selectFrom('users')
    .select(['id', 'public_id', 'password_hash', 'status', 'totp_enabled_at'])
    .where((eb) => eb.or([eb(sql`lower(email)`, '=', input.login), eb(sql`lower(username)`, '=', input.login)]))
    .where('status', '!=', 'deleted')
    .executeTakeFirst();

  // Verify against a dummy hash when there is no password, so the response time doesn't reveal it.
  const valid = await argon2.verify(user?.password_hash ?? (await dummyHash()), input.password);
  if (!user || !user.password_hash || !valid) {
    loginThrottle.fail(throttleKey);
    throw unauthorized('Wrong email, username or password');
  }
  loginThrottle.succeed(throttleKey);
  return finishSignIn(user, input, sign);
}

/** Second step for accounts with two-factor sign-in. */
export async function completeMfaLogin(mfaToken: string, code: string, sign: TokenSigner): Promise<SignedIn> {
  const challenge = verifyToken<{ u: string; d: Device }>('mfa', mfaToken);
  if (!challenge) throw unauthorized('Sign-in expired. Start again.');

  const throttleKey = `mfa:${challenge.u}`;
  loginThrottle.check(throttleKey);
  const user = await db
    .selectFrom('users')
    .select(['id', 'status', 'totp_secret'])
    .where('public_id', '=', challenge.u)
    .executeTakeFirst();
  const secret = user?.totp_secret ? decrypt('totp', user.totp_secret) : null;
  if (!user || user.status !== 'active' || !secret || !verifyTotp(secret, code)) {
    loginThrottle.fail(throttleKey);
    throw unauthorized('Wrong code');
  }
  loginThrottle.succeed(throttleKey);
  return startSession(user.id, challenge.d, sign);
}

/**
 * Google sign-in. The ID token is verified by providers.google. An existing Google link signs in;
 * otherwise a verified Google email links to the account with that email, or creates a new one.
 */
export async function signInWithGoogle(input: { id_token: string } & Device, sign: TokenSigner): Promise<SignedIn | MfaChallenge> {
  let identity;
  try {
    identity = await providers.google.verify(input.id_token);
  } catch {
    throw unauthorized('Google sign-in could not be verified');
  }
  const email = identity.email.toLowerCase();

  const userId = await db.transaction().execute(async (trx) => {
    const linked = await trx
      .selectFrom('auth_identities')
      .select('user_id')
      .where('provider', '=', 'google')
      .where('provider_subject', '=', identity.subject)
      .executeTakeFirst();
    if (linked) return linked.user_id;

    if (!identity.emailVerified) throw unauthorized('Your Google email is not verified');
    const existing = await trx.selectFrom('users').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    const id =
      existing?.id ??
      (await insertUser(trx, { email, username: await availableUsername(trx, email), password_hash: null, email_verified_at: new Date() })).id;
    await trx
      .insertInto('auth_identities')
      .values({ provider: 'google', provider_subject: identity.subject, user_id: id })
      .execute();
    return id;
  });

  const user = await db
    .selectFrom('users')
    .select(['id', 'public_id', 'status', 'totp_enabled_at'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (user.status === 'deleted') throw unauthorized('This account was deleted');
  return finishSignIn(user, input, sign);
}

async function finishSignIn(
  user: { id: number; public_id: string; status: string; totp_enabled_at: Date | null },
  device: Device,
  sign: TokenSigner,
): Promise<SignedIn | MfaChallenge> {
  if (user.status === 'suspended') throw forbidden('This account is suspended');
  if (user.totp_enabled_at) {
    const pendingDevice: Device = { platform: device.platform, app_version: device.app_version ?? null };
    return {
      mfa_required: true,
      mfa_token: signToken('mfa', { u: user.public_id, d: pendingDevice }, new Date(Date.now() + MFA_TOKEN_TTL_MS)),
    };
  }
  return startSession(user.id, device, sign);
}

// ---------- Sessions and refresh rotation ----------

async function startSession(userId: number, device: Device, sign: TokenSigner): Promise<SignedIn> {
  const secret = randomToken();
  const sessionPublicId = randomUUID();
  await db
    .insertInto('sessions')
    .values({
      public_id: sessionPublicId,
      user_id: userId,
      refresh_token_hash: hashToken(secret),
      platform: device.platform,
      app_version: device.app_version ?? null,
      expires_at: refreshExpiry(),
    })
    .execute();
  return tokensFor(userId, sessionPublicId, secret, sign);
}

/**
 * Swaps a refresh token for a new pair. Each refresh token works once. If an old one comes back,
 * someone copied it, so the whole session is revoked.
 */
export async function refresh(refreshToken: string, sign: TokenSigner): Promise<SignedIn> {
  const [sessionPublicId, secret] = refreshToken.split('.');
  const uuid = /^[0-9a-f-]{36}$/;
  if (!sessionPublicId || !secret || !uuid.test(sessionPublicId)) throw unauthorized('Invalid refresh token');

  const session = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id', 's.user_id', 's.refresh_token_hash', 's.revoked_at', 's.expires_at', 'u.status'])
    .where('s.public_id', '=', sessionPublicId)
    .executeTakeFirst();
  if (!session || session.revoked_at || session.expires_at < new Date() || session.status !== 'active') {
    throw unauthorized('Your session has ended. Sign in again.');
  }

  const newSecret = randomToken();
  const rotated = await db
    .updateTable('sessions')
    .set({ refresh_token_hash: hashToken(newSecret), last_used_at: new Date(), expires_at: refreshExpiry() })
    .where('id', '=', session.id)
    .where('refresh_token_hash', '=', hashToken(secret))
    .where('revoked_at', 'is', null)
    .executeTakeFirst();

  if (rotated.numUpdatedRows === 0n) {
    await db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', session.id).execute();
    throw new HttpError(401, 'REFRESH_TOKEN_REUSED', 'This sign-in was used elsewhere. Sign in again.');
  }
  return tokensFor(session.user_id, sessionPublicId, newSecret, sign);
}

async function tokensFor(userId: number, sessionPublicId: string, secret: string, sign: TokenSigner): Promise<SignedIn> {
  const user = await getAccount(userId);
  return {
    access_token: sign({ sub: user.id, sid: sessionPublicId }),
    refresh_token: `${sessionPublicId}.${secret}`,
    token_type: 'Bearer',
    expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
    user,
  };
}

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

export async function revokeSession(userId: number, sessionPublicId: string): Promise<boolean> {
  const result = await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('public_id', '=', sessionPublicId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export function listSessions(userId: number, currentSessionId: number) {
  return db
    .selectFrom('sessions')
    .select([
      'public_id as id',
      'platform',
      'app_version',
      'created_at',
      'last_used_at',
      sql<boolean>`id = ${currentSessionId}`.as('current'),
    ])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .orderBy('last_used_at', 'desc')
    .execute();
}

/** Stores this device's push token (FCM), or clears it with null. */
export async function setPushToken(sessionId: number, pushToken: string | null): Promise<void> {
  await db.updateTable('sessions').set({ push_token: pushToken }).where('id', '=', sessionId).execute();
}

// ---------- Email verification and password reset ----------

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeAuthToken(token, 'verify_email');
  await db.updateTable('users').set({ email_verified_at: new Date(), updated_at: new Date() }).where('id', '=', userId).execute();
}

export async function resendVerification(userId: number): Promise<void> {
  const user = await db.selectFrom('users').select('email_verified_at').where('id', '=', userId).executeTakeFirstOrThrow();
  if (user.email_verified_at) throw conflict('Your email is already verified', 'ALREADY_VERIFIED');
  await emit(db, 'email.verify', userId, {});
}

/** Always succeeds, so the response can't reveal whether an account uses that email. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where(sql`lower(email)`, '=', email)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (user) await emit(db, 'email.password_reset', user.id, {});
}

/** Sets the new password and signs out every device. */
export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  const passwordHash = await argon2.hash(password);
  await db.transaction().execute(async (trx) => {
    const userId = await consumeAuthToken(token, 'reset_password', trx);
    const now = new Date();
    await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: now }).where('id', '=', userId).execute();
    await trx.updateTable('sessions').set({ revoked_at: now }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
    await trx
      .updateTable('auth_tokens')
      .set({ used_at: now })
      .where('user_id', '=', userId)
      .where('purpose', '=', 'reset_password')
      .where('used_at', 'is', null)
      .execute();
  });
}

/** Marks a one-time code used and returns its user, or throws if it is unknown, used or expired. */
async function consumeAuthToken(token: string, purpose: 'verify_email' | 'reset_password', trx: Db = db): Promise<number> {
  const row = await trx
    .updateTable('auth_tokens')
    .set({ used_at: new Date() })
    .where('token_hash', '=', hashToken(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returning('user_id')
    .executeTakeFirst();
  if (!row) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
  return row.user_id;
}

// ---------- Helpers ----------

async function insertUser(
  trx: Db,
  values: { email: string; username: string; password_hash: string | null; email_verified_at?: Date },
): Promise<{ id: number }> {
  try {
    const user = await trx.insertInto('users').values(values).returning('id').executeTakeFirstOrThrow();
    await emitSearchSync(trx, 'user', user.id);
    return user;
  } catch (error) {
    if (isPgError(error, PgError.uniqueViolation)) {
      const constraint = (error as { constraint?: string }).constraint ?? '';
      if (constraint.includes('username')) throw conflict('That username is taken', 'USERNAME_TAKEN');
      if (constraint.includes('email')) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');
    }
    throw error;
  }
}

/** A free username based on the email's local part, for accounts created through Google. */
async function availableUsername(trx: Db, email: string): Promise<string> {
  const base = (email.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24).padEnd(3, '0');
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await trx.selectFrom('users').select('id').where(sql`lower(username)`, '=', candidate).executeTakeFirst();
    if (!taken) return candidate;
  }
  return `${base}${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= argon2.hash(randomToken()));
