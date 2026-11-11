import type { UpdateListItem } from './types';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'unavailable';

/** The subset of the WHATWG WebSocket API used here (global in Node >= 22 / VS Code >= 1.101). */
interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

type WebSocketCtor = new (url: string) => MinimalWebSocket;

export interface UpdatesSocketOptions {
  url: string;
  loginMessage: string;
  onUpdate: (update: UpdateListItem) => void;
  onStatus?: (status: SocketStatus) => void;
  log?: (message: string) => void;
  WebSocket?: WebSocketCtor;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Subscribes to the Komodo Core update stream (`/ws/update`) and reconnects with
 * exponential backoff. Komodo pushes an `UpdateListItem` for every operation
 * (deploy, restart, ...) whether it was started from here, the UI or automation.
 */
export class UpdatesSocket {
  private socket: MinimalWebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoff: number;
  private disposed = false;
  private loggedIn = false;
  private failedLogins = 0;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;

  constructor(private readonly options: UpdatesSocketOptions) {
    this.minBackoff = options.minBackoffMs ?? 2_000;
    this.maxBackoff = options.maxBackoffMs ?? 60_000;
    this.backoff = this.minBackoff;
  }

  start(): void {
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch {
      // ignore
    }
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }
    const Ctor = this.options.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) {
      this.options.log?.('WebSocket is not available in this VS Code version; using polling only.');
      this.options.onStatus?.('unavailable');
      return;
    }
    this.options.onStatus?.('connecting');
    let socket: MinimalWebSocket;
    try {
      socket = new Ctor(this.options.url);
    } catch (err) {
      this.options.log?.(`Update stream: cannot open websocket (${String(err)})`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.loggedIn = false;
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
      socket.send(this.options.loginMessage);
    });
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      if (data === 'LOGGED_IN') {
        this.loggedIn = true;
        this.failedLogins = 0;
        this.backoff = this.minBackoff;
        this.options.onStatus?.('connected');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        // Komodo sends plain-text errors (e.g. failed login) before closing.
        this.options.log?.(`Update stream: ${data.slice(0, 200)}`);
        return;
      }
      if (isUpdateListItem(parsed)) {
        this.options.onUpdate(parsed);
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = undefined;
      if (opened && !this.loggedIn) {
        // Connected but the login was refused: most likely invalid credentials.
        this.failedLogins++;
      }
      this.options.onStatus?.('disconnected');
      if (this.failedLogins >= MAX_FAILED_LOGINS) {
        // Komodo rate-limits failed logins: stop instead of locking the user out.
        this.options.log?.('Update stream: login refused repeatedly, giving up until the connection is reconfigured.');
        return;
      }
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // A `close` event always follows; reconnection is handled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
  }
}

const MAX_FAILED_LOGINS = 3;

function isUpdateListItem(value: unknown): value is UpdateListItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Partial<UpdateListItem>;
  return typeof v.id === 'string' && typeof v.operation === 'string' && typeof v.status === 'string' && !!v.target;
}
