import * as vscode from 'vscode';
import { formatError } from '../api/client';
import { TerminalConnection, terminalWebsocketUrl, type TerminalCloseInfo } from '../api/terminal';
import type { TerminalTarget } from '../api/types';
import type { ConnectionManager } from '../connection';
import { newSessionName, type TerminalSpec } from './specs';

const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[39m`;
const red = (text: string) => `\x1b[31m${text}\x1b[39m`;

interface Session {
  name: string;
  target: TerminalTarget;
}

/**
 * A VS Code terminal bridged to a Komodo terminal session:
 * `CreateTerminal` (unique name) → websocket `/ws/terminal` → `DeleteTerminal` when closed.
 */
class KomodoPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidClose = this.closeEmitter.event;

  private socket: TerminalConnection | undefined;
  private session: Session | undefined;
  private dimensions: vscode.TerminalDimensions | undefined;
  private state: 'idle' | 'connecting' | 'connected' | 'ended' | 'disposed' = 'idle';
  private earlyInput: string[] = [];
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly spec: TerminalSpec,
    private readonly connection: ConnectionManager,
    private readonly log: vscode.LogOutputChannel,
    private readonly onDisposed: (pty: KomodoPseudoterminal) => void,
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.dimensions = initialDimensions;
    void this.connect();
  }

  /** The user closed the VS Code terminal. */
  close(): void {
    void this.shutdown();
  }

  handleInput(data: string): void {
    if (this.state === 'ended') {
      if (data === '\r' || data === '\n') {
        void this.connect();
      } else {
        this.closeEmitter.fire();
        void this.shutdown();
      }
      return;
    }
    if (this.socket) {
      this.socket.sendInput(data);
    } else if (this.state === 'connecting') {
      this.earlyInput.push(data);
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;
    this.socket?.resize(dimensions.rows, dimensions.columns);
  }

  /** Closes the websocket and deletes the Komodo session. Idempotent. */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= (async () => {
      this.state = 'disposed';
      this.socket?.close();
      this.socket = undefined;
      await this.deleteSession();
      this.onDisposed(this);
      this.writeEmitter.dispose();
      this.closeEmitter.dispose();
    })();
    return this.shutdownPromise;
  }

  /** Not inlined: TypeScript would narrow `state` across the `await` in `connect`. */
  private isDisposed(): boolean {
    return this.state === 'disposed';
  }

  private write(text: string): void {
    if (this.state !== 'disposed') {
      this.writeEmitter.fire(text);
    }
  }

  private async connect(): Promise<void> {
    if (this.state === 'disposed' || this.state === 'connecting') {
      return;
    }
    const client = this.connection.getClient();
    if (!client) {
      this.end('Komodo is not configured — run "Komodo: Configure Connection…"');
      return;
    }
    this.state = 'connecting';
    const name = newSessionName();
    const target = this.spec.target;
    const shell = this.spec.command ? `${this.spec.command} on ` : 'a shell on ';
    this.write(dim(`Opening ${shell}${this.spec.description} via ${client.host}…`) + '\r\n');
    try {
      await client.write('CreateTerminal', {
        name,
        target,
        command: this.spec.command,
        mode: target.type === 'Server' ? undefined : 'exec',
        recreate: 'Always',
      });
    } catch (err) {
      this.end(`Cannot open a terminal on ${this.spec.description}: ${formatError(err)}`);
      return;
    }
    const session: Session = { name, target };
    if (this.isDisposed()) {
      // Closed while the session was being created.
      await this.deleteSession(session);
      return;
    }
    this.session = session;
    this.log.info(`Terminal session "${name}" opened on ${this.spec.description}.`);
    const socket: TerminalConnection = new TerminalConnection({
      url: terminalWebsocketUrl(client.baseUrl, target, name),
      loginMessage: client.websocketLoginMessage(),
      onReady: () => {
        if (this.socket === socket) {
          this.state = 'connected';
        }
      },
      onData: (text) => this.write(text),
      onNotice: (text) => this.write(red(text.trim()) + '\r\n'),
      onClose: (info) => this.onRemoteClose(socket, info),
    });
    this.socket = socket;
    if (this.dimensions) {
      socket.resize(this.dimensions.rows, this.dimensions.columns);
    }
    for (const input of this.earlyInput.splice(0)) {
      socket.sendInput(input);
    }
    socket.open();
  }

  private onRemoteClose(socket: TerminalConnection, info: TerminalCloseInfo): void {
    if (this.socket !== socket || this.state === 'disposed') {
      return;
    }
    this.socket = undefined;
    const reason = info.reason ? `: ${info.reason}` : '';
    this.end(info.loggedIn ? `Session ended${reason}` : `Komodo refused the connection${reason}`);
    // The shell exited or is unreachable: do not leave the session behind on the server.
    void this.deleteSession();
  }

  private end(message: string): void {
    if (this.state === 'disposed') {
      return;
    }
    this.state = 'ended';
    this.earlyInput = [];
    this.write(`\r\n${yellow(`[${message}]`)}\r\n${dim('Press Enter to open a new session, any other key to close this terminal.')}\r\n`);
  }

  private async deleteSession(session: Session | undefined = this.session): Promise<void> {
    if (!session) {
      return;
    }
    if (session === this.session) {
      this.session = undefined;
    }
    const client = this.connection.getClient();
    if (!client) {
      return;
    }
    try {
      await client.write('DeleteTerminal', { target: session.target, terminal: session.name });
      this.log.info(`Terminal session "${session.name}" deleted.`);
    } catch (err) {
      // Already gone (e.g. the shell exited) or Core unreachable.
      this.log.debug(`DeleteTerminal "${session.name}": ${formatError(err)}`);
    }
  }
}

/** Opens Komodo terminals and makes sure their server-side sessions are cleaned up. */
export class TerminalManager implements vscode.Disposable {
  private readonly open = new Set<KomodoPseudoterminal>();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  openTerminal(spec: TerminalSpec): vscode.Terminal {
    const pty = new KomodoPseudoterminal(spec, this.connection, this.log, (p) => this.open.delete(p));
    this.open.add(pty);
    const terminal = vscode.window.createTerminal({
      name: spec.title,
      pty,
      iconPath: new vscode.ThemeIcon(spec.target.type === 'Server' ? 'server-environment' : 'package'),
      // Sessions cannot be re-attached after a window reload.
      isTransient: true,
    });
    terminal.show();
    return terminal;
  }

  get openCount(): number {
    return this.open.size;
  }

  /** Deletes the sessions of every open terminal (best effort, bounded by `timeoutMs`). */
  async closeAll(timeoutMs = 2500): Promise<void> {
    const pending = [...this.open].map((pty) => pty.shutdown());
    if (!pending.length) {
      return;
    }
    await Promise.race([Promise.allSettled(pending), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  dispose(): void {
    void this.closeAll();
  }
}
