import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PLATFORMS, USERNAME_PATTERN } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { perIp, perUser } from '../../lib/rate-limits';
import { idParams } from '../../lib/validation';
import * as auth from './auth.service';
import * as twoFactor from './two-factor.service';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email'));
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);
const device = { platform: z.enum(PLATFORMS), app_version: z.string().max(30).nullish() };
const code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

// Emails and usernames are stored lowercase, and unique ignoring case.
const SignupBody = z.object({
  email,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, 'Username must be 3–30 characters: letters, numbers, _ or .'),
  password,
  ...device,
});

const LoginBody = z.object({
  login: z.string().trim().toLowerCase().min(1).max(254), // email or username
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  ...device,
});

/** Routes used before signing in. */
export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const sign = (claims: Parameters<auth.TokenSigner>[0]) => app.jwt.sign(claims);

  app.post('/signup', { config: perIp(10), schema: { body: SignupBody } }, async (request, reply) =>
    reply.status(201).send(await auth.signup(request.body, sign)),
  );

  // Returns tokens, or { mfa_required, mfa_token } when the account has two-factor sign-in.
  app.post('/login', { config: perIp(10), schema: { body: LoginBody } }, async (request) => auth.login(request.body, sign));

  app.post(
    '/login/mfa',
    { config: perIp(10), schema: { body: z.object({ mfa_token: z.string().max(1000), code }) } },
    async (request) => auth.completeMfaLogin(request.body.mfa_token, request.body.code, sign),
  );

  app.post(
    '/google',
    { config: perIp(10), schema: { body: z.object({ id_token: z.string().max(5000), ...device }) } },
    async (request) => auth.signInWithGoogle(request.body, sign),
  );

  app.post(
    '/refresh',
    { config: perIp(60), schema: { body: z.object({ refresh_token: z.string().max(200) }) } },
    async (request) => auth.refresh(request.body.refresh_token, sign),
  );

  app.post(
    '/verify-email',
    { config: perIp(10), schema: { body: z.object({ token: z.string().max(200) }) } },
    async (request, reply) => {
      await auth.verifyEmail(request.body.token);
      return reply.status(204).send();
    },
  );

  app.post(
    '/password-reset/request',
    { config: perIp(5), schema: { body: z.object({ email }) } },
    async (request, reply) => {
      await auth.requestPasswordReset(request.body.email);
      return reply.status(202).send({ message: 'If that email has an account, we sent a reset link.' });
    },
  );

  app.post(
    '/password-reset/confirm',
    { config: perIp(10), schema: { body: z.object({ token: z.string().max(200), password }) } },
    async (request, reply) => {
      await auth.confirmPasswordReset(request.body.token, request.body.password);
      return reply.status(204).send();
    },
  );
};

/** Signed-in routes for the account's own security: sign-out, devices, verification, two-factor. */
export const accountSecurityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/auth/logout', async (request, reply) => {
    await auth.revokeSession(request.auth.userId, request.auth.sessionPublicId);
    return reply.status(204).send();
  });

  app.post('/auth/resend-verification', { config: perUser(3, '1 hour') }, async (request, reply) => {
    await auth.resendVerification(request.auth.userId);
    return reply.status(202).send();
  });

  app.get('/sessions', async (request) => ({
    items: await auth.listSessions(request.auth.userId, request.auth.sessionId),
  }));

  app.delete('/sessions/:id', { schema: { params: idParams } }, async (request, reply) => {
    if (!(await auth.revokeSession(request.auth.userId, request.params.id))) throw notFound('Session');
    return reply.status(204).send();
  });

  app.put(
    '/sessions/current/push-token',
    { schema: { body: z.object({ push_token: z.string().max(4096).nullable() }) } },
    async (request, reply) => {
      await auth.setPushToken(request.auth.sessionId, request.body.push_token);
      return reply.status(204).send();
    },
  );

  app.post('/me/2fa/setup', async (request) => twoFactor.setupTwoFactor(request.auth.userId));

  app.post('/me/2fa/enable', { config: perUser(10), schema: { body: z.object({ code }) } }, async (request, reply) => {
    await twoFactor.enableTwoFactor(request, request.body.code);
    return reply.status(204).send();
  });

  app.delete('/me/2fa', { config: perUser(10), schema: { body: z.object({ code }) } }, async (request, reply) => {
    await twoFactor.disableTwoFactor(request, request.body.code);
    return reply.status(204).send();
  });
};
