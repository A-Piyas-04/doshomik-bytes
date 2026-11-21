import { describe, expect, it } from 'vitest';
import { createUser, useTestApp } from './helpers';

const ctx = useTestApp();

const signup = (payload: Record<string, string>) =>
  ctx.app.inject({ method: 'POST', url: '/auth/signup', payload });

describe('sign up and log in', () => {
  it('creates an account, lowercasing email and username, without exposing the password hash', async () => {
    const response = await signup({ email: 'Ali@Example.com', username: 'Ali_01', password: 'password123' });

    expect(response.statusCode).toBe(201);
    const { token, user } = response.json();
    expect(token).toEqual(expect.any(String));
    expect(user).toMatchObject({ email: 'ali@example.com', username: 'ali_01', role: 'user' });
    expect(user).not.toHaveProperty('password_hash');
  });

  it('gives specific errors for a taken username, a used email and a short password', async () => {
    await signup({ email: 'a@example.com', username: 'ali', password: 'password123' });

    const taken = await signup({ email: 'b@example.com', username: 'ali', password: 'password123' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('USERNAME_TAKEN');

    const used = await signup({ email: 'A@example.com', username: 'other', password: 'password123' });
    expect(used.json().error.code).toBe('EMAIL_TAKEN');

    const short = await signup({ email: 'c@example.com', username: 'third', password: 'short' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with email or username and rejects a wrong password', async () => {
    await signup({ email: 'ali@example.com', username: 'ali', password: 'password123' });
    const login = (body: object) => ctx.app.inject({ method: 'POST', url: '/auth/login', payload: body });

    expect((await login({ login: 'ali', password: 'password123' })).statusCode).toBe(200);
    expect((await login({ login: 'ALI@example.com', password: 'password123' })).statusCode).toBe(200);
    expect((await login({ login: 'ali', password: 'wrong-password' })).statusCode).toBe(401);
  });

  it('requires a valid token everywhere else', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    const bad = await ctx.app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
  });
});

describe('profile', () => {
  it('edits display name and bio; an empty string clears a field', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const patch = (payload: object) => ctx.app.inject({ method: 'PATCH', url: '/me', headers: ali.headers, payload });

    expect((await patch({ display_name: 'Ali Khan', bio: 'ML student' })).json()).toMatchObject({
      display_name: 'Ali Khan',
      bio: 'ML student',
    });
    expect((await patch({ bio: '' })).json()).toMatchObject({ display_name: 'Ali Khan', bio: null });
  });

  it('shows post and follow counts on the profile page', async () => {
    const ali = await createUser(ctx.app, 'ali');
    const bina = await createUser(ctx.app, 'bina');
    await ctx.app.inject({ method: 'PUT', url: `/users/${ali.id}/follow`, headers: bina.headers });
    await ctx.app.inject({ method: 'POST', url: '/posts', headers: ali.headers, payload: { type: 'text', caption: 'Hi' } });

    const profile = await ctx.app.inject({ method: 'GET', url: `/users/${ali.id}`, headers: bina.headers });
    expect(profile.json()).toMatchObject({
      username: 'ali',
      posts_count: 1,
      followers_count: 1,
      following_count: 0,
      is_following: true,
    });
  });
});
