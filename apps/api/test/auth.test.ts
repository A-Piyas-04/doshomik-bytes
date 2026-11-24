import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { env } from '../src/config/env';
import { call, createUser, currentCode, googleAccounts, runWorker, sent, tokenFromLastEmail, useTestApp } from './helpers';

const ctx = useTestApp();
const device = { platform: 'android', app_version: '1.0.0' };

const signup = (payload: Record<string, string>) =>
  ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { password: 'password123', ...device, ...payload } });
const login = (loginName: string, password = 'password123') =>
  ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: loginName, password, ...device } });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('sign-up and sign-in', () => {
  it('returns an access token, a refresh token and the account, with public ids only', async () => {
    const response = await signup({ email: 'Ali@Example.com', username: 'Ali_01' });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 900, user: { email: 'ali@example.com', username: 'ali_01', email_verified: false } });
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.refresh_token).toMatch(new RegExp(`^[0-9a-f-]{36}\\.`));
    expect(body.user).not.toHaveProperty('password_hash');

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(body.access_token) });
    expect(me.json().id).toBe(body.user.id);
  });

  it('rejects case-only duplicates of an email or username', async () => {
    await signup({ email: 'ali@example.com', username: 'ali' });
    expect((await signup({ email: 'other@example.com', username: 'ALI' })).json().error.code).toBe('USERNAME_TAKEN');
    expect((await signup({ email: 'ALI@example.com', username: 'other' })).json().error.code).toBe('EMAIL_TAKEN');
  });

  it('signs in by email or username, and slows down repeated failures for an account', async () => {
    await signup({ email: 'bina@example.com', username: 'bina' });
    expect((await login('bina')).statusCode).toBe(200);
    expect((await login('BINA@example.com')).statusCode).toBe(200);

    for (let i = 0; i < 3; i++) expect((await login('bina', 'wrong-password')).statusCode).toBe(401);
    const throttled = await login('bina');
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('returns errors with a code and a request id, never a stack trace', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatchObject({ code: 'UNAUTHORIZED', request_id: response.headers['x-request-id'] });
  });
});

describe('sessions', () => {
  it('rotates the refresh token, and revokes the session when an old one is reused', async () => {
    const user = await createUser(ctx.app, 'ali');
    const refresh = (token: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: token } });

    const first = await refresh(user.refreshToken);
    expect(first.statusCode).toBe(200);
    const { access_token, refresh_token } = first.json();
    expect(refresh_token).not.toBe(user.refreshToken);

    // The old token comes back: someone copied it. The whole session ends.
    const reused = await refresh(user.refreshToken);
    expect(reused.json().error.code).toBe('REFRESH_TOKEN_REUSED');
    expect((await refresh(refresh_token)).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(access_token) })).statusCode).toBe(401);
  });

  it('lists devices and signs out one of them at once', async () => {
    const phone = await createUser(ctx.app, 'ali');
    const tablet = (await login('ali')).json();

    const sessions = await call(ctx.app, phone, 'GET', '/v1/sessions');
    expect(sessions.body.items).toHaveLength(2);
    const other = sessions.body.items.find((s: { current: boolean }) => !s.current);

    expect((await call(ctx.app, phone, 'DELETE', `/v1/sessions/${other.id}`)).status).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(tablet.access_token) })).statusCode).toBe(401);

    expect((await call(ctx.app, phone, 'POST', '/v1/auth/logout')).status).toBe(204);
    expect((await call(ctx.app, phone, 'GET', '/v1/me')).status).toBe(401);
  });
});

describe('email verification and password reset', () => {
  it('emails a one-time code that verifies the address', async () => {
    const user = await createUser(ctx.app, 'ali');
    await runWorker();
    expect(sent.emails).toHaveLength(1);

    const token = tokenFromLastEmail();
    const stored = await db.selectFrom('auth_tokens').select('token_hash').executeTakeFirstOrThrow();
    expect(stored.token_hash).not.toBe(token); // only the hash is kept

    expect((await call(ctx.app, null, 'POST', '/v1/auth/verify-email', { token })).status).toBe(204);
    expect((await call(ctx.app, user, 'GET', '/v1/me')).body.email_verified).toBe(true);
    expect((await call(ctx.app, null, 'POST', '/v1/auth/verify-email', { token })).body.error.code).toBe('INVALID_TOKEN');
  });

  it('resets the password, signs out everywhere, and never reveals whether an email exists', async () => {
    const user = await createUser(ctx.app, 'ali');
    await runWorker();
    sent.emails.length = 0;

    const unknown = await call(ctx.app, null, 'POST', '/v1/auth/password-reset/request', { email: 'nobody@example.com' });
    const known = await call(ctx.app, null, 'POST', '/v1/auth/password-reset/request', { email: 'ali@example.com' });
    expect(unknown).toEqual(known);
    await runWorker();
    expect(sent.emails).toHaveLength(1);

    const reset = await call(ctx.app, null, 'POST', '/v1/auth/password-reset/confirm', { token: tokenFromLastEmail(), password: 'new-password-1' });
    expect(reset.status).toBe(204);
    expect((await call(ctx.app, user, 'GET', '/v1/me')).status).toBe(401);
    expect((await login('ali', 'new-password-1')).statusCode).toBe(200);
  });
});

describe('Google sign-in', () => {
  it('creates an account on first sign-in and signs into it afterwards', async () => {
    googleAccounts.set('google-token', { subject: 'g-123', email: 'Rahman.ML@gmail.com', emailVerified: true });
    const google = () => call(ctx.app, null, 'POST', '/v1/auth/google', { id_token: 'google-token', ...device });

    const first = await google();
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ email: 'rahman.ml@gmail.com', username: 'rahman.ml', email_verified: true });

    const second = await google();
    expect(second.body.user.id).toBe(first.body.user.id);
    expect((await call(ctx.app, null, 'POST', '/v1/auth/google', { id_token: 'forged', ...device })).status).toBe(401);
  });

  it('links to an existing account with the same verified email', async () => {
    const user = await createUser(ctx.app, 'ali');
    googleAccounts.set('google-token', { subject: 'g-456', email: 'ali@example.com', emailVerified: true });
    const result = await call(ctx.app, null, 'POST', '/v1/auth/google', { id_token: 'google-token', ...device });
    expect(result.body.user.id).toBe(user.id);
  });
});

describe('two-factor sign-in', () => {
  it('asks for a code after the password once it is on', async () => {
    const user = await createUser(ctx.app, 'ali');
    const { body: setup } = await call(ctx.app, user, 'POST', '/v1/me/2fa/setup');
    expect(setup.otpauth_url).toContain('otpauth://totp/');
    expect((await call(ctx.app, user, 'POST', '/v1/me/2fa/enable', { code: '000000' })).body.error.code).toBe('WRONG_CODE');
    expect((await call(ctx.app, user, 'POST', '/v1/me/2fa/enable', { code: currentCode(setup.secret) })).status).toBe(204);

    const step1 = (await login('ali')).json();
    expect(step1).toMatchObject({ mfa_required: true });
    expect(step1).not.toHaveProperty('access_token');

    const step2 = await call(ctx.app, null, 'POST', '/v1/auth/login/mfa', { mfa_token: step1.mfa_token, code: currentCode(setup.secret) });
    expect(step2.status).toBe(200);
    expect(step2.body.access_token).toEqual(expect.any(String));
  });

  it('is required before staff can use admin routes', async () => {
    const admin = await createUser(ctx.app, 'boss', { role: 'admin' });
    expect((await call(ctx.app, admin, 'GET', '/v1/admin/papers')).status).toBe(200);

    await db.updateTable('users').set({ totp_enabled_at: null }).where('public_id', '=', admin.id).execute();
    expect((await call(ctx.app, admin, 'GET', '/v1/admin/papers')).body.error.code).toBe('MFA_REQUIRED');

    const regular = await createUser(ctx.app, 'ali');
    expect((await call(ctx.app, regular, 'GET', '/v1/admin/papers')).status).toBe(403);
  });
});

describe('dev auth bypass (DEV_AUTH_BYPASS)', () => {
  const asDev = (url: string, user?: string) =>
    ctx.app.inject({ method: 'GET', url, headers: user ? { 'x-dev-user': user } : {} });

  afterEach(() => {
    env.DEV_AUTH_BYPASS = false;
    env.DEV_AUTH_USER = 'admin';
  });

  it('is off by default: no token is 401', async () => {
    await createUser(ctx.app, 'admin', { role: 'admin' });
    expect((await asDev('/v1/me')).statusCode).toBe(401);
  });

  it('acts as DEV_AUTH_USER or x-dev-user without a token, reusing one session', async () => {
    env.DEV_AUTH_BYPASS = true;
    const admin = await createUser(ctx.app, 'admin');
    const other = await createUser(ctx.app, 'learner1');

    expect((await asDev('/v1/me')).json().id).toBe(admin.id);
    expect((await asDev('/v1/me', 'Learner1')).json().id).toBe(other.id);
    await asDev('/v1/me');
    const sessions = await db.selectFrom('sessions').select('user_id').where('app_version', '=', 'dev-bypass').execute();
    expect(sessions).toHaveLength(2);

    expect((await asDev('/v1/me', 'nobody')).statusCode).toBe(401);
  });

  it('opens staff routes for an admin without two-factor, but not for a regular user', async () => {
    env.DEV_AUTH_BYPASS = true;
    await createUser(ctx.app, 'admin');
    await db.updateTable('users').set({ role: 'admin' }).where('username', '=', 'admin').execute();
    await createUser(ctx.app, 'learner1');

    expect((await asDev('/v1/admin/papers')).statusCode).toBe(200);
    expect((await asDev('/v1/admin/papers', 'learner1')).statusCode).toBe(403);
  });

  it('still checks a token when one is sent', async () => {
    env.DEV_AUTH_BYPASS = true;
    await createUser(ctx.app, 'admin');
    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer not-a-token' } });
    expect(response.statusCode).toBe(401);
  });
});
