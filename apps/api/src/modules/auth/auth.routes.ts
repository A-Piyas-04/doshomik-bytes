import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthorized } from '../../lib/errors';
import * as auth from './auth.service';

// Emails and usernames are stored lowercase so "Ali" and "ali" can't both sign up.
const SignupBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email')),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, 'Username must be 3–30 characters: letters, numbers, _ or .'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH),
});

const LoginBody = z.object({
  login: z.string().trim().toLowerCase().min(1).max(254), // email or username
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// Per IP; only applies when the rate-limit plugin is registered (not in tests).
const rateLimited = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/signup', { config: rateLimited, schema: { body: SignupBody } }, async (request, reply) => {
    const user = await auth.createUser(request.body);
    return reply.status(201).send({ token: app.jwt.sign({ id: user.id }), user });
  });

  app.post('/login', { config: rateLimited, schema: { body: LoginBody } }, async (request) => {
    const user = await auth.verifyCredentials(request.body.login, request.body.password);
    if (!user) throw unauthorized('Wrong email, username or password');
    return { token: app.jwt.sign({ id: user.id }), user };
  });
};
