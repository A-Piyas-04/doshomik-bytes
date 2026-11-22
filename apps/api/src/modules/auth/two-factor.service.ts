import type { FastifyRequest } from 'fastify';
import { db } from '../../db';
import { audit } from '../../lib/audit';
import { decrypt, encrypt } from '../../lib/crypto';
import { badRequest, conflict } from '../../lib/errors';
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp';

// Two-factor sign-in with an authenticator app. Required for admins and moderators
// (lib/auth.ts requireRole); optional for everyone else.

/** Step 1: a new secret for the authenticator app. Nothing changes until `enable` confirms a code. */
export async function setupTwoFactor(userId: number) {
  const user = await db.selectFrom('users').select(['username', 'totp_enabled_at']).where('id', '=', userId).executeTakeFirstOrThrow();
  if (user.totp_enabled_at) throw conflict('Two-factor sign-in is already on', 'TWO_FACTOR_ENABLED');

  const secret = generateTotpSecret();
  await db.updateTable('users').set({ totp_secret: encrypt('totp', secret) }).where('id', '=', userId).execute();
  return { secret, otpauth_url: totpUri(secret, user.username) };
}

/** Step 2: the first code from the app proves it was set up correctly. */
export async function enableTwoFactor(request: FastifyRequest, code: string): Promise<void> {
  const { userId } = request.auth;
  await assertCode(userId, code);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ totp_enabled_at: new Date() }).where('id', '=', userId).execute();
    await audit(trx, request, { action: 'user.two_factor_enable', entityType: 'user', entityId: userId });
  });
}

export async function disableTwoFactor(request: FastifyRequest, code: string): Promise<void> {
  const { userId } = request.auth;
  await assertCode(userId, code);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ totp_secret: null, totp_enabled_at: null }).where('id', '=', userId).execute();
    await audit(trx, request, { action: 'user.two_factor_disable', entityType: 'user', entityId: userId });
  });
}

async function assertCode(userId: number, code: string): Promise<void> {
  const user = await db.selectFrom('users').select('totp_secret').where('id', '=', userId).executeTakeFirstOrThrow();
  const secret = user.totp_secret ? decrypt('totp', user.totp_secret) : null;
  if (!secret) throw badRequest('Set up two-factor sign-in first', 'TWO_FACTOR_NOT_SET_UP');
  if (!verifyTotp(secret, code)) throw badRequest('Wrong code', 'WRONG_CODE');
}
