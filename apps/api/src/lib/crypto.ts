import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

// Every use of APP_SECRET gets its own derived key, so a key leaked from one purpose
// (say, signed media URLs) can't forge or decrypt anything else.
export type KeyPurpose = 'jwt' | 'cursor' | 'upload' | 'media' | 'mfa' | 'totp';

const keys = new Map<KeyPurpose, Buffer>();
export function deriveKey(purpose: KeyPurpose): Buffer {
  let key = keys.get(purpose);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', env.APP_SECRET, '', `doshomik:${purpose}`, 32));
    keys.set(purpose, key);
  }
  return key;
}

/** A random, URL-safe secret. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** One-way hash for secrets kept in the database (refresh tokens, email codes). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A short self-contained token: base64url(JSON) + "." + HMAC. Tamper-proof, not secret.
 * `expiresAt` is required: every signed token in this app expires.
 */
export function signToken(purpose: KeyPurpose, data: Record<string, unknown>, expiresAt: Date): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  return `${body}.${hmac(purpose, body)}`;
}

/** Returns the token's data, or null if it was tampered with or has expired. */
export function verifyToken<T extends Record<string, unknown>>(purpose: KeyPurpose, token: string): T | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(hmac(purpose, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return data.exp * 1000 > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function hmac(purpose: KeyPurpose, value: string): string {
  return createHmac('sha256', deriveKey(purpose)).update(value).digest('base64url');
}

/** AES-256-GCM. Output: base64url(iv | auth tag | ciphertext). */
export function encrypt(purpose: KeyPurpose, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/** Returns null if the value was not produced by `encrypt` with the same purpose. */
export function decrypt(purpose: KeyPurpose, value: string): string | null {
  try {
    const data = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(purpose), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
