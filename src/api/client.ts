import type {
  ExecuteRequests,
  ExecuteType,
  ReadParams,
  ReadResponse,
  ReadType,
  Update,
  User,
  WriteParams,
  WriteResponse,
  WriteType,
} from './types';

export interface Credentials {
  key: string;
  secret: string;
}

/** Error returned by Komodo Core (or raised while trying to reach it). */
export class KomodoApiError extends Error { 
  constructor(
    message: string,
    /** HTTP status, or `0` when Komodo Core could not be reached. */
    readonly status: number,
    readonly trace: readonly string[] = [],
    readonly code?: 'timeout' | 'cancelled' | 'network' | 'invalid-response',
  ) {
    super(message);
    this.name = 'KomodoApiError';
  }

  /** Invalid / revoked API key. Komodo rate-limits failed logins, so callers must not retry these. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isCancelled(): boolean {
    return this.code === 'cancelled';
  }
}

export interface ClientOptions {
  /** Per-request timeout. Default 30s. */
  timeoutMs?: number;
  /** Injectable fetch, for tests. */
  fetch?: typeof fetch;
}

/** Normalises user input like `komodo.example.com/` into `https://komodo.example.com`. */
export function normalizeBaseUrl(input: string): string {
  let value = input.trim();
  if (!value) {
    throw new Error('The Komodo Core URL is empty.');
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${input}" is not a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The Komodo Core URL must start with https:// or http://.');
  }
  if (url.username || url.password) {
    throw new Error('Do not put credentials in the URL; use the API key and secret instead.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** Minimal typed client for the Komodo Core HTTP API (`/read`, `/execute`, `/user`). */
export class KomodoClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    private readonly credentials: Credentials,
    options: ClientOptions = {},
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** `host[:port]` of Komodo Core, for display. */
  get host(): string {
    return new URL(this.baseUrl).host;
  }

  /** URL of the update stream websocket. */
  get updatesWebsocketUrl(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/ws/update`;
  }

  /** Login message for the update stream websocket. */
  websocketLoginMessage(): string {
    return JSON.stringify({
      type: 'ApiKeys',
      params: { key: this.credentials.key, secret: this.credentials.secret },
    });
  }

  read<T extends ReadType>(type: T, params: ReadParams<T>, signal?: AbortSignal): Promise<ReadResponse<T>> {
    return this.request<ReadResponse<T>>('POST', `/read/${type}`, params, signal);
  }

  /** Starts an execution. Resolves as soon as Komodo has created the {@link Update}, not when it completes. */
  execute<T extends ExecuteType>(type: T, params: ExecuteRequests[T], signal?: AbortSignal): Promise<Update> {
    return this.request<Update>('POST', `/execute/${type}`, params, signal);
  }

  /** `/write/<Type>`. Only the requests in {@link WriteRequests} (terminal sessions) are used. */
  write<T extends WriteType>(type: T, params: WriteParams<T>, signal?: AbortSignal): Promise<WriteResponse<T>> {
    return this.request<WriteResponse<T>>('POST', `/write/${type}`, params, signal);
  }

  /** The user owning the API key. */
  getUser(signal?: AbortSignal): Promise<User> {
    return this.request<User>('GET', '/user', undefined, signal);
  }

  async version(signal?: AbortSignal): Promise<string> {
    return (await this.read('GetVersion', {}, signal)).version;
  }

  private async request<R>(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<R> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': this.credentials.key,
          'x-api-secret': this.credentials.secret,
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: combined,
      });
      text = await response.text();
    } catch (err) {
      if (signal?.aborted) {
        throw new KomodoApiError('Request cancelled.', 0, [], 'cancelled');
      }
      if (timeout.aborted) {
        throw new KomodoApiError(
          `Komodo Core (${this.host}) did not answer within ${Math.round(this.timeoutMs / 1000)}s.`,
          0,
          [],
          'timeout',
        );
      }
      throw new KomodoApiError(`Cannot reach Komodo Core at ${this.host}: ${describeNetworkError(err)}`, 0, [], 'network');
    }
    if (!response.ok) {
      throw errorFromResponse(response.status, text);
    }
    try {
      return JSON.parse(text) as R;
    } catch {
      throw new KomodoApiError(
        `Unexpected (non JSON) response from ${this.host}${path}. Is the URL pointing to Komodo Core?`,
        response.status,
        [],
        'invalid-response',
      );
    }
  }
}

/** Builds an error from a non-2xx Komodo response (`{ "error": "...", "trace": [...] }`). */
export function errorFromResponse(status: number, text: string): KomodoApiError {
  let message = '';
  let trace: string[] = [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      message = (parsed as { error: string }).error;
      const rawTrace = (parsed as { trace?: unknown }).trace;
      trace = Array.isArray(rawTrace) ? rawTrace.map(String).filter(Boolean) : [];
    }
  } catch {
    message = text.trim().replace(/\s+/g, ' ').slice(0, 300);
  }
  if (!message) {
    message = `HTTP ${status}`;
  }
  return new KomodoApiError(message, status, trace);
}

/** Human readable message, including the Komodo error trace when present. */
export function formatError(err: unknown): string {
  if (err instanceof KomodoApiError) {
    const extra = err.trace.filter((line) => !err.message.includes(line));
    return extra.length ? `${err.message}: ${extra.join(' → ')}` : err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function describeNetworkError(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  if (cause?.code) {
    return cause.message ? `${cause.code} (${cause.message})` : cause.code;
  }
  if (cause?.message) {
    return cause.message;
  }
  return err instanceof Error ? err.message : String(err);
}
