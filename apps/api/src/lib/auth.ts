import type { UserRole } from '@doshomik/shared';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { db } from '../db';
import { hashToken, randomToken } from './crypto';
import { forbidden, unauthorized } from './errors';

/** With DEV_AUTH_BYPASS on, picks which seeded user a token-less request acts as. */
export const DEV_USER_HEADER = 'x-dev-user';
/** Marks the sessions the bypass creates, so they are reused and easy to find. */
const DEV_SESSION_TAG = 'dev-bypass';

/** Access-token claims: public ids only, so a token reveals nothing about row counts. */
export interface AccessClaims {
  sub: string; // users.public_id
  sid: string; // sessions.public_id
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

/** Who is calling, resolved once per request. Internal ids are for queries and never leave the server. */
export interface AuthContext {
  userId: number;
  userPublicId: string;
  role: UserRole;
  sessionId: number;
  sessionPublicId: string;
  mfaEnabled: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/**
 * onRequest hook for signed-in routes. Besides the JWT, it checks the session is not revoked and
 * the account is active, so signing out a device or suspending an account takes effect at once.
 */
export async function authenticate(request: FastifyRequest): Promise<void> {
  if (env.DEV_AUTH_BYPASS && !request.headers.authorization) {
    request.auth = await devAuthContext(request);
    return;
  }

  let claims: AccessClaims;
  try {
    claims = await request.jwtVerify<AccessClaims>();
  } catch {
    throw unauthorized();
  }

  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['u.id as userId', 'u.public_id as userPublicId', 'u.role', 'u.totp_enabled_at', 's.id as sessionId'])
    .where('s.public_id', '=', claims.sid)
    .where('u.public_id', '=', claims.sub)
    .where('s.revoked_at', 'is', null)
    .where('s.expires_at', '>', new Date())
    .where('u.status', '=', 'active')
    .executeTakeFirst();
  if (!row) throw unauthorized('Your session has ended. Sign in again.');

  request.auth = {
    userId: row.userId,
    userPublicId: row.userPublicId,
    role: row.role as UserRole,
    sessionId: row.sessionId,
    sessionPublicId: claims.sid,
    mfaEnabled: row.totp_enabled_at !== null,
  };
}

/**
 * Development only (DEV_AUTH_BYPASS): acts as an existing active user with no token. Reuses one
 * long-lived session per user so session-based routes (sign out, push token) still work.
 * Counts as two-factor signed in, so staff routes open for a seeded admin.
 */
async function devAuthContext(request: FastifyRequest): Promise<AuthContext> {
  const header = request.headers[DEV_USER_HEADER];
  const username = (typeof header === 'string' && header.trim() ? header : env.DEV_AUTH_USER).trim().toLowerCase();

  const user = await db
    .selectFrom('users')
    .select(['id', 'public_id', 'role'])
    .where('username', '=', username)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!user) throw unauthorized(`Dev sign-in: no active user "${username}". Run pnpm db:seed, or send ${DEV_USER_HEADER}.`);

  let session = await db
    .selectFrom('sessions')
    .select(['id', 'public_id'])
    .where('user_id', '=', user.id)
    .where('app_version', '=', DEV_SESSION_TAG)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  if (!session) {
    session = await db
      .insertInto('sessions')
      .values({
        user_id: user.id,
        refresh_token_hash: hashToken(randomToken()), // never handed out: this session can't be refreshed
        platform: 'web',
        app_version: DEV_SESSION_TAG,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      })
      .returning(['id', 'public_id'])
      .executeTakeFirstOrThrow();
  }

  return {
    userId: user.id,
    userPublicId: user.public_id,
    role: user.role as UserRole,
    sessionId: session.id,
    sessionPublicId: session.public_id,
    mfaEnabled: true,
  };
}

/** onRequest hook for staff routes: the role (admins may do anything moderators can) and two-factor sign-in. */
export function requireRole(minimum: 'moderator' | 'admin') {
  return async (request: FastifyRequest): Promise<void> => {
    const { role, mfaEnabled } = request.auth;
    const allowed = minimum === 'admin' ? role === 'admin' : role === 'admin' || role === 'moderator';
    if (!allowed) throw forbidden(`${minimum === 'admin' ? 'Admin' : 'Moderator'} access required`);
    if (!mfaEnabled) throw forbidden('Turn on two-factor sign-in to use staff tools', 'MFA_REQUIRED');
  };
}
