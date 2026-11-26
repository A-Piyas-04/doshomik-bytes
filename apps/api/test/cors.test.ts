import { describe, expect, it } from 'vitest';
import { useTestApp } from './helpers';

const ctx = useTestApp();

describe('CORS', () => {
  it('lets an allowed browser origin use every verb the API has', async () => {
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/v1/papers/00000000-0000-4000-8000-000000000000/save',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const methods = String(preflight.headers['access-control-allow-methods']);
    for (const method of ['PUT', 'PATCH', 'DELETE']) expect(methods).toContain(method);
  });

  it('gives other origins no CORS headers', async () => {
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/v1/feed',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
