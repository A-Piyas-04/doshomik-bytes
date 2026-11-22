import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time codes (RFC 6238): 6 digits, 30-second steps, SHA-1, the format every
// authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) understands.

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new random secret, base32-encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) secret += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return secret;
}

/** The otpauth:// link an authenticator app reads from a QR code. */
export function totpUri(secret: string, accountName: string, issuer = 'Doshomik Bytes'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Accepts the current code and one step either side, to allow for clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpCode(secret, step + offset));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, '0');
}

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value === -1) throw new Error('Invalid base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
