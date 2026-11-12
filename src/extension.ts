import * as vscode from 'vscode';
import { ActionRunner } from './actions/runner';
import { formatError } from './api/client';
import { UpdatesSocket, type SocketStatus } from './api/updatesSocket';
import type { UpdateListItem } from './api/types';
import { registerCommands } from './commands';
import { getSettings } from './config';
import { ConnectionManager } from './connection';
import { KomodoDocumentProvider, SCHEME } from './documents/provider';
import { relativeTime } from './model/format';
import { KomodoStore } from './model/store';
import { StatusBarController } from './statusBar';
import { TerminalManager } from './terminal/komodoTerminal';
import { ActivityProvider, ServersProvider, StacksProvider } from './tree/providers';
import { StatsPanelManager } from './webview/statsPanel';

/** Refresh period while every Komodo view is hidden (keeps the status bar reasonably fresh). */
const BACKGROUND_INTERVAL_MS = 5 * 60_000;

/** Polls Komodo: every `komodo.refreshInterval` seconds while a view is visible, every 5 minutes otherwise. */
class RefreshScheduler implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: KomodoStore,
    private readonly anyViewVisible: () => boolean,
  ) {}

  reschedule(): void {
    clearTimeout(this.timer);
    const seconds = getSettings().refreshInterval;
    if (seconds <= 0) {
      return;
    }
    const interval = this.anyViewVisible() ? seconds * 1000 : Math.max(seconds * 1000, BACKGROUND_INTERVAL_MS);
    this.timer = setTimeout(() => {
      void this.store.refresh().finally(() => this.reschedule());
    }, interval);
  }

  /** Refreshes right away if the data is older than the refresh interval. */
  onViewShown(): void {
    const snapshot = this.store.snapshot;
    const interval = getSettings().refreshInterval * 1000;
    if (snapshot && interval > 0 && Date.now() - snapshot.fetchedAt > interval) {
      void this.store.refresh();
    }
    this.reschedule();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

/** Keeps the update websocket in sync with the connection and settings. */
class RealtimeController implements vscode.Disposable {
  private socket: UpdatesSocket | undefined;
  private status: SocketStatus = 'disconnected';
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly store: KomodoStore,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      connection.onDidChange(() => this.restart()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('komodo.realtimeUpdates')) {
          this.restart();
        }
      }),
      store.onDidChange(() => {
        // Stop after an auth failure; restart once a refresh succeeds again.
        if (store.authFailed && this.socket) {
          this.stop();
        } else if (!store.authFailed && !this.socket && store.snapshot && this.wanted()) {
          this.restart();
        }
      }),
    );
  }

  get socketStatus(): SocketStatus {
    return this.status;
  }

  private wanted(): boolean {
    return this.connection.isConfigured && getSettings().realtimeUpdates && !this.store.authFailed;
  }

  restart(): void {
    this.stop();
    const client = this.connection.getClient();
    if (!client || !this.wanted()) {
      return;
    }
    this.socket = new UpdatesSocket({
      url: client.updatesWebsocketUrl,
      loginMessage: client.websocketLoginMessage(),
      onUpdate: (update) => this.onUpdate(update),
      onStatus: (status) => {
        if (status !== this.status) {
          this.log.debug(`Update stream: ${status}`);
        }
        this.status = status;
      },
      log: (message) => this.log.info(message),
    });
    this.socket.start();
  }

  private stop(): void {
    this.socket?.dispose();
    this.socket = undefined;
    this.status = 'disconnected';
  }

  private onUpdate(update: UpdateListItem): void {
    this.store.upsertUpdate(update);
    if (['Server', 'Stack', 'Deployment', 'System', 'Swarm'].includes(update.target.type)) {
      this.store.refreshSoon(update.status === 'Complete' ? 800 : 2500);
    }
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/** Kept for `deactivate`, to delete the Komodo sessions of terminals still open. */
let terminalManager: TerminalManager | undefined;

export interface KomodoExtensionApi {
  readonly store: KomodoStore;
  readonly connection: ConnectionManager;
}

export async function activate(context: vscode.ExtensionContext): Promise<KomodoExtensionApi> {
  const log = vscode.window.createOutputChannel('Komodo', { log: true });
  const connection = new ConnectionManager(context, log);
  const store = new KomodoStore(connection, log);
  const docs = new KomodoDocumentProvider(connection, store, log);
  const runner = new ActionRunner(connection, store, docs, log);
  const terminals = new TerminalManager(connection, log);
  terminalManager = terminals;
  const stats = new StatsPanelManager(context, connection, store, docs, terminals);

  const serversProvider = new ServersProvider(store, connection);
  const stacksProvider = new StacksProvider(store, connection);
  const activityProvider = new ActivityProvider(store, connection);
  const serversView = vscode.window.createTreeView('komodo.servers', {
    treeDataProvider: serversProvider,
    canSelectMany: true,
    showCollapseAll: true,
  });
  const stacksView = vscode.window.createTreeView('komodo.stacks', {
    treeDataProvider: stacksProvider,
    canSelectMany: true,
    showCollapseAll: true,
  });
  const activityView = vscode.window.createTreeView('komodo.activity', { treeDataProvider: activityProvider });
  const views = [serversView, stacksView, activityView];

  const scheduler = new RefreshScheduler(store, () => views.some((v) => v.visible));
  const realtime = new RealtimeController(connection, store, log);
  const statusBar = new StatusBarController(store, connection);

  const decorateViews = () => {
    const snapshot = store.snapshot;
    const message =
      store.error !== undefined && snapshot
        ? `⚠ ${formatError(store.error)} — showing data from ${relativeTime(snapshot.fetchedAt)}.`
        : undefined;
    const description = store.filter ? `filter: ${store.filter}` : undefined;
    for (const view of [serversView, stacksView]) {
      view.message = message;
      view.description = description;
    }
  };

  context.subscriptions.push(
    log,
    connection,
    store,
    docs,
    stats,
    terminals,
    serversProvider,
    stacksProvider,
    activityProvider,
    ...views,
    scheduler,
    realtime,
    statusBar,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, docs),
    store.onDidChange(decorateViews),
    ...views.map((view) =>
      view.onDidChangeVisibility((e) => {
        if (e.visible) {
          scheduler.onViewShown();
        } else {
          scheduler.reschedule();
        }
      }),
    ),
    activityView.onDidChangeVisibility((e) => {
      if (e.visible && connection.isConfigured) {
        void store.loadUpdates();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('komodo.refreshInterval')) {
        scheduler.reschedule();
      }
      if (
        e.affectsConfiguration('komodo.servers') ||
        e.affectsConfiguration('komodo.services')
      ) {
        serversProvider.refresh();
        stacksProvider.refresh();
      }
    }),
  );

  registerCommands({ context, store, connection, runner, docs, stats, terminals, log });

  // Loads the credentials from Secret Storage; fires onDidChange (→ first refresh + websocket) when configured.
  await connection.initialize();
  scheduler.reschedule();
  log.info(
    connection.isConfigured
      ? `Komodo extension ready (${connection.getClient()?.host}).`
      : 'Komodo extension ready: no connection configured yet (run "Komodo: Configure Connection…").',
  );

  return { store, connection };
}

export async function deactivate(): Promise<void> {
  // Everything else is disposed through context.subscriptions. Terminal sessions live on the
  // servers, so give the DeleteTerminal calls a moment to complete.
  await terminalManager?.closeAll(2500);
  terminalManager = undefined;
}
