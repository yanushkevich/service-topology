/**
 * Minimal client for the backend HTTP API (docs/api/openapi.json). Errors are RFC 9457 problems;
 * they surface as ApiError with the status, title, and request ID for support. No credentials are
 * stored in the bundle: browser access relies on same-origin requests (dev/preview proxy) and,
 * in deployments, on an authenticating proxy (ADR-018).
 */

/** One entry of a problem's `errors[]` (validation codes, docs/API_CONTRACT.md). */
export interface ProblemIssue {
  code: string;
  entityId?: string;
  /** The field of a board definition (ADR-031). */
  path?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly requestId: string | undefined,
    readonly codes: readonly string[] = [],
    readonly detail: string | undefined = undefined,
    readonly issues: readonly ProblemIssue[] = [],
  ) {
    super(`${status} ${title}${requestId ? ` (request ${requestId})` : ''}`);
    this.name = 'ApiError';
  }
}

/** A response body with its ETag (the topology revision on /topology and entity writes). */
export interface Tagged<T> {
  data: T;
  etag: string | null;
}

export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | undefined>;
  /** GET with the response ETag. */
  getTagged<T>(path: string, signal?: AbortSignal): Promise<Tagged<T>>;
  /** A write with an optional If-Match precondition; returns the body (undefined for 204) and ETag. */
  sendTagged<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, ifMatch: string | null): Promise<Tagged<T | undefined>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createApiClient(baseUrl = '/api/v1', fetchImpl: FetchLike = (...args) => fetch(...args)): ApiClient {
  const request = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal, ifMatch?: string | null): Promise<Tagged<T | undefined>> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    const etag = res.headers.get('ETag');
    if (res.status === 204) return { data: undefined, etag };
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const problem = (json ?? {}) as { title?: string; detail?: string; requestId?: string; errors?: { code?: string; entityId?: string; message?: string }[] };
      const issues = (problem.errors ?? []).map((e) => ({ code: e.code ?? '', message: e.message ?? '', ...(e.entityId ? { entityId: e.entityId } : {}) }));
      throw new ApiError(res.status, problem.title ?? res.statusText ?? 'Request failed', problem.requestId ?? res.headers.get('X-Request-ID') ?? undefined,
        issues.map((e) => e.code).filter(Boolean), problem.detail, issues);
    }
    return { data: json as T, etag };
  };
  return {
    get: async <T>(path: string, signal?: AbortSignal) => (await request<T>('GET', path, undefined, signal)).data as T,
    send: async (method, path, body) => (await request(method, path, body)).data as never,
    getTagged: async <T>(path: string, signal?: AbortSignal) => (await request<T>('GET', path, undefined, signal)) as Tagged<T>,
    sendTagged: (method, path, body, ifMatch) => request(method, path, body, undefined, ifMatch),
  };
}
