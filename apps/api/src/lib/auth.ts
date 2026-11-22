import type { UserRole } from '@doshomik/shared';
import type { FastifyRequest } from 'fastify';
import { db } from '../db';
import { forbidden, unauthorized } from './errors';

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

/** onRequest hook for staff routes: the role (admins may do anything moderators can) and two-factor sign-in. */
export function requireRole(minimum: 'moderator' | 'admin') {
  return async (request: FastifyRequest): Promise<void> => {
    const { role, mfaEnabled } = request.auth;
    const allowed = minimum === 'admin' ? role === 'admin' : role === 'admin' || role === 'moderator';
    if (!allowed) throw forbidden(`${minimum === 'admin' ? 'Admin' : 'Moderator'} access required`);
    if (!mfaEnabled) throw forbidden('Turn on two-factor sign-in to use staff tools', 'MFA_REQUIRED');
  };
}
