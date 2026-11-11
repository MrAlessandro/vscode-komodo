import type { TerminalTarget } from './types';

/**
 * Komodo terminal websocket protocol (`/ws/terminal`), as used by the Komodo web UI:
 *
 * 1. connect to `/ws/terminal?target[type]=…&target[params][…]=…&terminal=<session>`;
 * 2. send the login message (text), wait for the `LOGGED_IN` text frame;
 * 3. output arrives as binary frames (raw pty bytes);
 * 4. input is sent as binary frames: payload bytes + a trailing `0x01`;
 *    resize is `{"rows":R,"cols":C}` (UTF-8) + a trailing `0xFF`.
 */

const STDIN_MARKER = 0x01;
const RESIZE_MARKER = 0xff;

const encoder = new TextEncoder();

function withMarker(bytes: Uint8Array, marker: number): Uint8Array {
  const frame = new Uint8Array(bytes.length + 1);
  frame.set(bytes);
  frame[bytes.length] = marker;
  return frame;
}

/** Keyboard input frame. UTF-8 encoded (the web UI truncates non-ASCII characters; this does not). */
export function encodeInput(data: string): Uint8Array {
  return withMarker(encoder.encode(data), STDIN_MARKER);
}

/** Terminal resize frame. */
export function encodeResize(rows: number, cols: number): Uint8Array {
  return withMarker(encoder.encode(JSON.stringify({ rows, cols })), RESIZE_MARKER);
}

/** Query string for `/ws/terminal` (bracket keys as parsed by Komodo Core, values URI-encoded). */
export function terminalQuery(target: TerminalTarget, terminal: string): string {
  const parts = [`target[type]=${target.type}`];
  for (const [key, value] of Object.entries(target.params)) {
    parts.push(`target[params][${key}]=${encodeURIComponent(value)}`);
  }
  parts.push(`terminal=${encodeURIComponent(terminal)}`);
  return parts.join('&');
}

export function terminalWebsocketUrl(baseUrl: string, target: TerminalTarget, terminal: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/ws/terminal?${terminalQuery(target, terminal)}`;
}

/** The subset of the WHATWG WebSocket API used by the terminal connection. */
interface TerminalWebSocket {
  binaryType: string;
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event?: { code?: number; reason?: string }) => void): void;
}

type TerminalWebSocketCtor = new (url: string) => TerminalWebSocket;

const OPEN = 1;

export interface TerminalCloseInfo {
  /** Whether Komodo accepted the login (i.e. the session was actually attached). */
  loggedIn: boolean;
  code?: number;
  reason?: string;
}

export interface TerminalConnectionOptions {
  url: string;
  loginMessage: string;
  /** Terminal output (UTF-8 decoded, multi-byte sequences split across frames are handled). */
  onData: (text: string) => void;
  /** Login accepted; input and resize are now forwarded. */
  onReady?: () => void;
  /** Text sent by Komodo before the login completed (usually an error). */
  onNotice?: (text: string) => void;
  onClose: (info: TerminalCloseInfo) => void;
  WebSocket?: TerminalWebSocketCtor;
}

/** One websocket attached to a Komodo terminal session. */
export class TerminalConnection {
  private socket: TerminalWebSocket | undefined;
  private loggedIn = false;
  private finished = false;
  private readonly decoder = new TextDecoder('utf-8');
  private pendingInput: string[] = [];
  private size: { rows: number; cols: number } | undefined;
  private sizeConfirmed = false;

  constructor(private readonly options: TerminalConnectionOptions) {}

  get isReady(): boolean {
    return this.loggedIn && !this.finished;
  }

  open(): void {
    const Ctor = this.options.WebSocket ?? (globalThis as { WebSocket?: TerminalWebSocketCtor }).WebSocket;
    if (!Ctor) {
      this.finish({ loggedIn: false, reason: 'WebSocket is not available in this VS Code version (1.101+ required).' });
      return;
    }
    let socket: TerminalWebSocket;
    try {
      socket = new Ctor(this.options.url);
    } catch (err) {
      this.finish({ loggedIn: false, reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => socket.send(this.options.loginMessage));
    socket.addEventListener('message', (event) => this.onMessage(event.data));
    socket.addEventListener('close', (event) => {
      const tail = this.decoder.decode();
      if (tail) {
        this.options.onData(tail);
      }
      this.finish({ loggedIn: this.loggedIn, code: event?.code, reason: event?.reason || undefined });
    });
    socket.addEventListener('error', () => {
      // A `close` event always follows.
    });
  }

  /** Forwards keyboard input (queued until the login completes). */
  sendInput(data: string): void {
    if (this.finished || !data) {
      return;
    }
    if (!this.isReady) {
      this.pendingInput.push(data);
      return;
    }
    this.send(encodeInput(data));
  }

  resize(rows: number, cols: number): void {
    if (rows <= 0 || cols <= 0) {
      return;
    }
    this.size = { rows, cols };
    if (this.isReady) {
      this.send(encodeResize(rows, cols));
    }
  }

  /** Closes the websocket. The Komodo session itself keeps running until it is deleted. */
  close(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = undefined;
  }

  private onMessage(data: unknown): void {
    if (this.finished) {
      return;
    }
    if (!this.loggedIn) {
      const text = typeof data === 'string' ? data : this.decodeOnce(data);
      if (text === 'LOGGED_IN') {
        this.loggedIn = true;
        this.options.onReady?.();
        if (this.size) {
          this.send(encodeResize(this.size.rows, this.size.cols));
        }
        const pending = this.pendingInput.join('');
        this.pendingInput = [];
        if (pending) {
          this.send(encodeInput(pending));
        }
      } else if (text) {
        this.options.onNotice?.(text);
      }
      return;
    }
    if (!this.sizeConfirmed) {
      // `docker exec` sessions may start after the resize sent at login and come up as 24x80:
      // repeat the size once the process is alive (first output, e.g. the prompt).
      this.sizeConfirmed = true;
      if (this.size) {
        this.send(encodeResize(this.size.rows, this.size.cols));
      }
    }
    const text = typeof data === 'string' ? data : this.decoder.decode(toBytes(data), { stream: true });
    if (text) {
      this.options.onData(text);
    }
  }

  private decodeOnce(data: unknown): string {
    return new TextDecoder('utf-8').decode(toBytes(data));
  }

  private send(frame: Uint8Array): void {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(frame);
    }
  }

  private finish(info: TerminalCloseInfo): void {
    const wasFinished = this.finished;
    this.finished = true;
    this.socket = undefined;
    if (!wasFinished) {
      this.options.onClose(info);
    }
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return encoder.encode(String(data));
}
