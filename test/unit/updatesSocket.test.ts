import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatesSocket } from '../../src/api/updatesSocket';

type Listener = (event?: { data: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private readonly listeners: Record<string, Listener[]> = {};
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit('close');
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(data === undefined ? undefined : { data });
    }
  }
}

const UPDATE = {
  id: 'u1',
  operation: 'DeployStack',
  start_ts: 1,
  success: true,
  username: 'me',
  operator: 'me',
  target: { type: 'Stack', id: 'stk1' },
  status: 'Complete',
};

describe('UpdatesSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function create(onUpdate = vi.fn(), onStatus = vi.fn()) {
    const socket = new UpdatesSocket({
      url: 'wss://komodo.example.com/ws/update',
      loginMessage: '{"type":"ApiKeys"}',
      onUpdate,
      onStatus,
      WebSocket: FakeWebSocket as never,
      minBackoffMs: 100,
      maxBackoffMs: 1000,
    });
    socket.start();
    return socket;
  }

  it('logs in on open and forwards updates', () => {
    const onUpdate = vi.fn();
    const onStatus = vi.fn();
    create(onUpdate, onStatus);
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('wss://komodo.example.com/ws/update');
    ws.emit('open');
    expect(ws.sent).toEqual(['{"type":"ApiKeys"}']);
    ws.emit('message', 'LOGGED_IN');
    expect(onStatus).toHaveBeenLastCalledWith('connected');
    ws.emit('message', JSON.stringify(UPDATE));
    ws.emit('message', 'not json');
    ws.emit('message', JSON.stringify({ unrelated: true }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(UPDATE);
  });

  it('reconnects with exponential backoff after a disconnect', () => {
    create();
    const first = FakeWebSocket.instances[0];
    first.emit('open');
    first.emit('message', 'LOGGED_IN');
    first.emit('close');
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].emit('close'); // never opened: network error
    vi.advanceTimersByTime(199);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('gives up after repeated refused logins (Komodo rate-limits failed auth)', () => {
    create();
    for (let i = 0; i < 3; i++) {
      const ws = FakeWebSocket.instances.at(-1)!;
      ws.emit('open');
      ws.emit('message', 'Invalid user credentials');
      ws.emit('close');
      vi.advanceTimersByTime(5000);
    }
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('stops reconnecting once disposed', () => {
    const socket = create();
    socket.dispose();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
