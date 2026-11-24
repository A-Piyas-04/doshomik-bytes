import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Where clients reach this server; used to build upload, media, share and email links. */
  PUBLIC_URL: z
    .url({ protocol: /^https?$/ })
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),

  DATABASE_URL: z.string().min(1),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  /** Root secret. Separate keys for tokens, cursors, signed URLs and 2FA secrets are derived from it. */
  APP_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Google OAuth client ids whose ID tokens are accepted. Empty disables Google sign-in. */
  GOOGLE_CLIENT_IDS: list,

  /**
   * Development only: requests without an Authorization header act as DEV_AUTH_USER (or the
   * username in an `x-dev-user` header), with no sign-in and no two-factor step. Requests that do
   * send a token still go through real auth. Refused when NODE_ENV=production.
   */
  DEV_AUTH_BYPASS: z.stringbool().default(false),
  DEV_AUTH_USER: z.string().default('admin'),

  CORS_ORIGINS: list,

  MEDIA_DIR: z.string().default('media'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  /** smtp(s)://user:pass@host:port. Empty writes emails to DEV_MAIL_DIR instead of sending them. */
  SMTP_URL: z.string().default(''),
  EMAIL_FROM: z.string().default('Doshomik Bytes <no-reply@localhost>'),
  DEV_MAIL_DIR: z.string().default('.dev-mail'),

  /**
   * Paper ingestion (worker only; the API never calls a scholarly service). OpenAlex asks clients
   * to send a contact address for its polite pool: use a team address, never a user's. A free
   * Semantic Scholar key raises its rate limit; without one, requests share a busy public pool.
   */
  PAPER_SYNC_ENABLED: z.stringbool().default(true),
  OPENALEX_MAILTO: z.string().default(''),
  SEMANTIC_SCHOLAR_API_KEY: z.string().default(''),

  ACCOUNT_PURGE_DAYS: z.coerce.number().int().positive().default(30),
  /** Used to count practice streaks in the users' local days. */
  APP_TIMEZONE: z.string().default('Asia/Dhaka'),

  MIN_APP_VERSION_ANDROID: z.string().default('0.0.0'),
  MIN_APP_VERSION_IOS: z.string().default('0.0.0'),
  /** For Android App Links (/.well-known/assetlinks.json) and the Play Store fallback of share links. */
  ANDROID_PACKAGE_NAME: z.string().default(''),
  ANDROID_CERT_FINGERPRINTS: list,
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
}

if (parsed.data.DEV_AUTH_BYPASS && parsed.data.NODE_ENV === 'production') {
  throw new Error('DEV_AUTH_BYPASS must not be set in production');
}

export const env = parsed.data;
