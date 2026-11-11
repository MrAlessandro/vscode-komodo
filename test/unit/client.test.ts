import { describe, expect, it, vi } from 'vitest';
import { KomodoApiError, KomodoClient, errorFromResponse, formatError, normalizeBaseUrl } from '../../src/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new KomodoClient('https://komodo.example.com/', { key: 'K-key', secret: 'S-secret' }, { fetch: fetchImpl, timeoutMs });
}

describe('normalizeBaseUrl', () => {
  it('adds https and strips trailing slashes, query and hash', () => {
    expect(normalizeBaseUrl('komodo.example.com/')).toBe('https://komodo.example.com');
    expect(normalizeBaseUrl(' https://komodo.example.com/?x=1#y ')).toBe('https://komodo.example.com');
    expect(normalizeBaseUrl('http://localhost:9120')).toBe('http://localhost:9120');
  });

  it('keeps a path prefix (Komodo behind a reverse proxy sub-path)', () => {
    expect(normalizeBaseUrl('https://example.com/komodo/')).toBe('https://example.com/komodo');
  });

  it('rejects invalid URLs, other protocols and embedded credentials', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/empty/);
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(/https/);
    expect(() => normalizeBaseUrl('https://user:pass@example.com')).toThrow(/credentials/);
    expect(() => normalizeBaseUrl('https://exa mple.com')).toThrow(/not a valid URL/);
  });
});

describe('KomodoClient', () => {
  it('POSTs reads to /read/<Type> with the API key headers and JSON params', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{ id: 'a' }]));
    const result = await clientWith(fetchImpl as unknown as typeof fetch).read('ListServers', { limit: 0 });
    expect(result).toEqual([{ id: 'a' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://komodo.example.com/read/ListServers');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"limit":0}');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-api-key': 'K-key',
      'x-api-secret': 'S-secret',
    });
  });

  it('POSTs executions to /execute/<Type>', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 'InProgress' }));
    await clientWith(fetchImpl as unknown as typeof fetch).execute('RestartStack', { stack: 'stk1', services: ['web'] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://komodo.example.com/execute/RestartStack');
    expect(JSON.parse(init.body as string)).toEqual({ stack: 'stk1', services: ['web'] });
  });

  it('POSTs terminal sessions to /write/<Type>', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { name: 'vscode-a', command: 'bash' }));
    const target = { type: 'Server' as const, params: { server: 'srv1' } };
    await clientWith(fetchImpl as unknown as typeof fetch).write('CreateTerminal', { name: 'vscode-a', target, command: 'bash', recreate: 'Always' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://komodo.example.com/write/CreateTerminal');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'vscode-a', target, command: 'bash', recreate: 'Always' });
  });

  it('GETs /user without a body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { username: 'me', admin: true, enabled: true }));
    const user = await clientWith(fetchImpl as unknown as typeof fetch).getUser();
    expect(user.username).toBe('me');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://komodo.example.com/user');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('turns Komodo error bodies into KomodoApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: 'Invalid user credentials | You have 4 attempts remaining', trace: [] }),
    );
    const err = await clientWith(fetchImpl as unknown as typeof fetch).read('GetVersion', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KomodoApiError);
    expect((err as KomodoApiError).status).toBe(401);
    expect((err as KomodoApiError).isAuthError).toBe(true);
    expect((err as KomodoApiError).message).toContain('Invalid user credentials');
  });

  it('reports unreachable hosts with the network error code', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND komodo.example.com' } });
    });
    const err = (await clientWith(fetchImpl as unknown as typeof fetch).read('GetVersion', {}).catch((e: unknown) => e)) as KomodoApiError;
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
    expect(err.message).toContain('komodo.example.com');
    expect(err.message).toContain('ENOTFOUND');
  });

  it('times out slow requests', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const err = (await clientWith(fetchImpl as unknown as typeof fetch, 20).read('GetVersion', {}).catch((e: unknown) => e)) as KomodoApiError;
    expect(err.code).toBe('timeout');
  });

  it('distinguishes caller cancellation from timeouts', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const pending = clientWith(fetchImpl as unknown as typeof fetch).read('GetVersion', {}, controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(((await pending) as KomodoApiError).isCancelled).toBe(true);
  });

  it('rejects non-JSON success responses (wrong URL, e.g. the web UI)', async () => {
    const fetchImpl = vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 }));
    const err = (await clientWith(fetchImpl as unknown as typeof fetch).read('GetVersion', {}).catch((e: unknown) => e)) as KomodoApiError;
    expect(err.code).toBe('invalid-response');
  });

  it('derives the websocket URL and login message', () => {
    const client = clientWith(vi.fn() as unknown as typeof fetch);
    expect(client.updatesWebsocketUrl).toBe('wss://komodo.example.com/ws/update');
    expect(new KomodoClient('http://localhost:9120', { key: 'k', secret: 's' }).updatesWebsocketUrl).toBe('ws://localhost:9120/ws/update');
    expect(JSON.parse(client.websocketLoginMessage())).toEqual({ type: 'ApiKeys', params: { key: 'K-key', secret: 'S-secret' } });
    expect(client.host).toBe('komodo.example.com');
  });
});

describe('errors', () => {
  it('parses error bodies and falls back to the raw text', () => {
    const e1 = errorFromResponse(500, '{"error":"Failed to restart","trace":["container not found"]}');
    expect(e1.message).toBe('Failed to restart');
    expect(e1.trace).toEqual(['container not found']);
    expect(formatError(e1)).toBe('Failed to restart: container not found');
    expect(errorFromResponse(502, 'Bad gateway\n').message).toBe('Bad gateway');
    expect(errorFromResponse(500, '').message).toBe('HTTP 500');
  });

  it('formats unknown errors', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
    expect(formatError('plain')).toBe('plain');
  });
});
