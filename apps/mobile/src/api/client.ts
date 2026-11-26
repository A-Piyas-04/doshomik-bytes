import { API_URL } from '@/config';
import { getPrefs } from '@/lib/prefs';

/** An API failure. `status` 0 means the request never reached the server (offline, timeout). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const TIMEOUT_MS = 15_000;

function buildUrl(path: string, query?: Query): string {
  const url = `${API_URL}/v1${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return params.length ? `${url}?${params.join('&')}` : url;
}

/**
 * Who the request acts as. Authentication is built last (owner's decision): until then the API
 * runs with DEV_AUTH_BYPASS and a request without an Authorization header acts as DEV_AUTH_USER,
 * or as the seeded user named in `x-dev-user` (switchable in Settings, development builds only).
 */
function authHeaders(): Record<string, string> {
  const devUser = getPrefs().devUser;
  return __DEV__ && devUser ? { 'x-dev-user': devUser } : {};
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', cancel, { once: true });

  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders() };
  // Never send a JSON content-type without a body: Fastify rejects it (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  let text: string;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    // The timeout covers the body too: a connection that stalls mid-body must not hang the screen.
    text = response.status === 204 ? '' : await response.text();
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Network error', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }

  if (response.status === 204) return undefined as T;
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    // A proxy's HTML error page or a truncated body: keep the status so screens show Retry.
    throw new ApiError(`HTTP ${response.status}`, response.status, 'BAD_RESPONSE');
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(error?.message ?? `HTTP ${response.status}`, response.status, error?.code ?? 'HTTP_ERROR', error?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
};
