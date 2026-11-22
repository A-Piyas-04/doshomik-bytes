import { HttpError } from '../../lib/errors';

/**
 * Growing delays after failed sign-ins for one account (the per-IP limit is @fastify/rate-limit).
 * After 3 failures: 5 s, then 10 s, 20 s ... up to 15 minutes. A success clears it.
 *
 * In memory, so it is per API process and resets on restart. Move it to Redis when Redis is
 * installed or the API runs more than one process (docs/prototype-2-implementation-notes.md).
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; blockedUntil: number }>();

  check(key: string): void {
    const entry = this.failures.get(key);
    const waitMs = entry ? entry.blockedUntil - Date.now() : 0;
    if (waitMs > 0) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`);
    }
  }

  fail(key: string): void {
    const count = (this.failures.get(key)?.count ?? 0) + 1;
    const delayMs = count < 3 ? 0 : Math.min(5_000 * 2 ** (count - 3), 15 * 60_000);
    this.failures.set(key, { count, blockedUntil: Date.now() + delayMs });
    if (this.failures.size > 10_000) this.prune();
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  private prune(): void {
    const cutoff = Date.now() - 15 * 60_000;
    for (const [key, entry] of this.failures) if (entry.blockedUntil < cutoff) this.failures.delete(key);
  }
}

export const loginThrottle = new LoginThrottle();
