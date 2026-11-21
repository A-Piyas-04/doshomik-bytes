import type { FastifyRequest } from 'fastify';
import { db } from '../db';
import { forbidden, unauthorized } from './errors';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number };
    user: { id: number };
  }
}

/** onRequest hook: requires a valid bearer token and sets `request.user`. */
export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized();
  }
}

/** onRequest hook for admin routes. The role is read from the database, so a demotion applies at once. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  const user = await db.selectFrom('users').select('role').where('id', '=', request.user.id).executeTakeFirst();
  if (user?.role !== 'admin') throw forbidden('Admin access required');
}
