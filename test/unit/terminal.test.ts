import { describe, expect, it, vi } from 'vitest';
import {
  TerminalConnection,
  encodeInput,
  encodeResize,
  terminalWebsocketUrl,
  type TerminalConnectionOptions,
} from '../../src/api/terminal';
import { containerTerminalSpec, newSessionName, serverTerminalSpec, serviceTerminalSpec } from '../../src/terminal/specs';

const bytes = (frame: Uint8Array) => [...frame];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

describe('terminal frames', () => {
  it('encodes keyboard input as UTF-8 + 0x01', () => {
    expect(bytes(encodeInput('ls\r'))).toEqual([0x6c, 0x73, 0x0d, 0x01]);
    expect(bytes(encodeInput('è'))).toEqual([0xc3, 0xa8, 0x01]);
    expect(bytes(encodeInput('\x03'))).toEqual([0x03, 0x01]);
  });

  it('encodes resize as JSON + 0xFF', () => {
    expect(bytes(encodeResize(24, 80))).toEqual([...utf8('{"rows":24,"cols":80}'), 0xff]);
  });

  it('builds the websocket URL like the Komodo UI', () => {
    expect(terminalWebsocketUrl('https://komodo.example.com', { type: 'Server', params: { server: 'srv1' } }, 'vscode-a')).toBe(
      'wss://komodo.example.com/ws/terminal?target[type]=Server&target[params][server]=srv1&terminal=vscode-a',
    );
    expect(
      terminalWebsocketUrl('http://localhost:19120', { type: 'Container', params: { server: 'srv1', container: 'shop web-1' } }, 'vscode-b'),
    ).toBe('ws://localhost:19120/ws/terminal?target[type]=Container&target[params][server]=srv1&target[params][container]=shop%20web-1&terminal=vscode-b');
    expect(terminalWebsocketUrl('https://k.example.com', { type: 'Stack', params: { stack: 'stk1', service: 'web' } }, 't')).toBe(
      'wss://k.example.com/ws/terminal?target[type]=Stack&target[params][stack]=stk1&target[params][service]=web&terminal=t',
    );
  });
});

type Listener = (event?: unknown) => void;

class FakeSocket {
  static last: FakeSocket;
  binaryType = 'blob';
  readyState = 0;
  sent: (string | Uint8Array)[] = [];
  closed = false;
  private readonly listeners: Record<string, Listener[]> = {};
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, event?: unknown): void {
    if (type === 'open') {
      this.readyState = 1;
    }
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

function connect(overrides: Partial<TerminalConnectionOptions> = {}) {
  const options = {
    url: 'wss://komodo.example.com/ws/terminal?x',
    loginMessage: '{"type":"ApiKeys"}',
    onData: vi.fn(),
    onReady: vi.fn(),
    onNotice: vi.fn(),
    onClose: vi.fn(),
    WebSocket: FakeSocket as never,
    ...overrides,
  };
  const connection = new TerminalConnection(options);
  connection.open();
  return { connection, options, socket: FakeSocket.last };
}

describe('TerminalConnection', () => {
  it('logs in, then sends the size and the input typed while connecting', () => {
    const { connection, options, socket } = connect();
    expect(socket.binaryType).toBe('arraybuffer');
    connection.resize(30, 120);
    connection.sendInput('whoami\r');
    socket.emit('open');
    expect(socket.sent).toEqual(['{"type":"ApiKeys"}']);
    socket.emit('message', { data: 'LOGGED_IN' });
    expect(options.onReady).toHaveBeenCalledOnce();
    expect(socket.sent.slice(1).map((f) => bytes(f as Uint8Array))).toEqual([
      bytes(encodeResize(30, 120)),
      bytes(encodeInput('whoami\r')),
    ]);
    connection.sendInput('x');
    expect(bytes(socket.sent.at(-1) as Uint8Array)).toEqual(bytes(encodeInput('x')));
  });

  it('repeats the size once the process is alive (docker exec starts as 24x80)', () => {
    const { connection, socket } = connect();
    connection.resize(40, 132);
    socket.emit('open');
    socket.emit('message', { data: 'LOGGED_IN' });
    expect(socket.sent).toHaveLength(2); // login + resize
    socket.emit('message', { data: new TextEncoder().encode('/data # ').buffer });
    expect(socket.sent).toHaveLength(3);
    expect(bytes(socket.sent[2] as Uint8Array)).toEqual(bytes(encodeResize(40, 132)));
    socket.emit('message', { data: new TextEncoder().encode('more').buffer });
    expect(socket.sent).toHaveLength(3);
  });

  it('decodes binary output, including UTF-8 characters split across frames', () => {
    const { options, socket } = connect();
    socket.emit('open');
    socket.emit('message', { data: 'LOGGED_IN' });
    const data = new TextEncoder().encode('ciao è\r\n');
    socket.emit('message', { data: data.slice(0, 6).buffer });
    socket.emit('message', { data: data.slice(6).buffer });
    expect((options.onData as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('')).toBe('ciao è\r\n');
  });

  it('reports errors sent before the login and the close', () => {
    const { options, socket } = connect();
    socket.emit('open');
    socket.emit('message', { data: 'Invalid user credentials' });
    socket.emit('close', { code: 1000, reason: '' });
    expect(options.onNotice).toHaveBeenCalledWith('Invalid user credentials');
    expect(options.onClose).toHaveBeenCalledWith({ loggedIn: false, code: 1000, reason: undefined });
    expect(options.onReady).not.toHaveBeenCalled();
  });

  it('reports the end of a session (e.g. `exit`)', () => {
    const { options, socket } = connect();
    socket.emit('open');
    socket.emit('message', { data: 'LOGGED_IN' });
    socket.emit('close', { code: 1000, reason: 'shell exited' });
    expect(options.onClose).toHaveBeenCalledWith({ loggedIn: true, code: 1000, reason: 'shell exited' });
  });

  it('does not report a close requested by the user', () => {
    const { connection, options, socket } = connect();
    socket.emit('open');
    socket.emit('message', { data: 'LOGGED_IN' });
    connection.close();
    socket.emit('close', { code: 1000 });
    expect(socket.closed).toBe(true);
    expect(options.onClose).not.toHaveBeenCalled();
    const sent = socket.sent.length;
    connection.sendInput('ignored');
    expect(socket.sent).toHaveLength(sent);
  });

  it('ignores empty sizes and fails cleanly without WebSocket support', () => {
    const { connection, socket } = connect();
    socket.emit('open');
    socket.emit('message', { data: 'LOGGED_IN' });
    connection.resize(0, 80);
    expect(socket.sent).toHaveLength(1);

    const onClose = vi.fn();
    const missing = new TerminalConnection({
      url: 'wss://x/ws/terminal',
      loginMessage: '{}',
      onData: vi.fn(),
      onClose,
      WebSocket: undefined,
    });
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try {
      missing.open();
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = original;
    }
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ loggedIn: false, reason: expect.stringContaining('WebSocket') }));
  });
});

describe('terminal specs', () => {
  it('targets servers, stack services and containers', () => {
    expect(serverTerminalSpec({ serverId: 'srv1', serverName: 'alpha' }, ' ')).toEqual({
      title: 'Komodo: alpha',
      description: 'server “alpha”',
      target: { type: 'Server', params: { server: 'srv1' } },
      command: undefined,
    });
    expect(serviceTerminalSpec({ stackId: 'stk1', stackName: 'shop' }, 'web', 'bash')).toMatchObject({
      title: 'Komodo: shop/web',
      target: { type: 'Stack', params: { stack: 'stk1', service: 'web' } },
      command: 'bash',
    });
    expect(containerTerminalSpec({ serverId: 'srv1', serverName: 'alpha', container: 'postgres' }, 'sh')).toMatchObject({
      title: 'Komodo: postgres',
      target: { type: 'Container', params: { server: 'srv1', container: 'postgres' } },
      command: 'sh',
    });
  });

  it('generates unique session names', () => {
    const name = newSessionName(1_700_000_000_000);
    expect(name).toMatch(/^vscode-[a-z0-9]+-[a-z0-9]{1,4}$/);
    expect(new Set(Array.from({ length: 50 }, () => newSessionName())).size).toBeGreaterThan(45);
  });
});
