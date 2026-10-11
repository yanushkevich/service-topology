/**
 * Minimal client for the backend HTTP API (docs/api/openapi.json). Errors are RFC 9457 problems;
 * they surface as ApiError with the status, title, and request ID for support. No credentials are
 * stored in the bundle: browser access relies on same-origin requests (dev/preview proxy) and,
 * in deployments, on an authenticating proxy (ADR-018).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly requestId: string | undefined,
    readonly codes: readonly string[] = [],
  ) {
    super(`${status} ${title}${requestId ? ` (request ${requestId})` : ''}`);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | undefined>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createApiClient(baseUrl = '/api/v1', fetchImpl: FetchLike = (...args) => fetch(...args)): ApiClient {
  const request = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T | undefined> => {
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    }
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (res.status === 204) return undefined;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const problem = (json ?? {}) as { title?: string; requestId?: string; errors?: { code?: string }[] };
      throw new ApiError(res.status, problem.title ?? res.statusText ?? 'Request failed', problem.requestId ?? res.headers.get('X-Request-ID') ?? undefined,
        (problem.errors ?? []).map((e) => e.code ?? '').filter(Boolean));
    }
    return json as T;
  };
  return {
    get: async <T>(path: string, signal?: AbortSignal) => (await request<T>('GET', path, undefined, signal)) as T,
    send: (method, path, body) => request(method, path, body),
  };
}
