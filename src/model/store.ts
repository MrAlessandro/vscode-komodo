import * as vscode from 'vscode';
import { KomodoApiError, formatError } from '../api/client';
import type { CoreInfo, ServerListItem, StackListItem, StackService, Tag, UpdateListItem } from '../api/types';
import type { ConnectionManager } from '../connection';
import { buildSnapshot, type ContainerOwner, type Snapshot } from './snapshot';

export type { ContainerOwner, Snapshot } from './snapshot';

const MAX_UPDATES = 100;

/**
 * Single source of truth for the tree views and the status bar.
 * One refresh = 3 Komodo calls (servers with stats, stacks, all stack services with container stats).
 */
export class KomodoStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly updatesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeUpdates = this.updatesEmitter.event;

  private _snapshot: Snapshot | undefined;
  private _error: unknown;
  private _authFailed = false;
  private _coreVersion: string | undefined;
  private _coreInfo: CoreInfo | undefined;
  private inflight: Promise<void> | undefined;
  private queued = false;
  private generation = 0;
  private soonTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly busy = new Map<string, string>();
  private _filter = '';
  private _updates: UpdateListItem[] | undefined;
  private _updatesError: unknown;
  private updatesInflight: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      this.changeEmitter,
      this.updatesEmitter,
      connection.onDidChange(() => {
        this.generation++;
        this._snapshot = undefined;
        this._error = undefined;
        this._authFailed = false;
        this._coreVersion = undefined;
        this._coreInfo = undefined;
        this._updates = undefined;
        this._updatesError = undefined;
        this.busy.clear();
        this.changeEmitter.fire();
        this.updatesEmitter.fire();
        if (connection.isConfigured) {
          void this.refresh({ force: true });
        }
      }),
    );
  }

  get snapshot(): Snapshot | undefined {
    return this._snapshot;
  }

  /** Error of the last refresh, if it failed. The previous snapshot (if any) is kept. */
  get error(): unknown {
    return this._error;
  }

  /** True after a 401: background refreshes stop until the user refreshes manually or reconfigures. */
  get authFailed(): boolean {
    return this._authFailed;
  }

  get coreVersion(): string | undefined {
    return this._coreVersion;
  }

  get coreInfo(): CoreInfo | undefined {
    return this._coreInfo;
  }

  get isRefreshing(): boolean {
    return this.inflight !== undefined;
  }

  /**
   * Refreshes the snapshot. Concurrent calls are coalesced. Background refreshes are
   * skipped after an authentication failure (Komodo rate-limits failed logins).
   */
  refresh(options: { force?: boolean } = {}): Promise<void> {
    if (this._authFailed && !options.force) {
      return Promise.resolve();
    }
    if (this.inflight) {
      this.queued = true;
      return this.inflight;
    }
    this.inflight = this.doRefresh().finally(() => {
      this.inflight = undefined;
      if (this.queued) {
        this.queued = false;
        void this.refresh();
      }
    });
    return this.inflight;
  }

  /** Debounced refresh, used when many update events arrive at once. */
  refreshSoon(delayMs = 1500): void {
    clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => void this.refresh(), delayMs);
  }

  /** Loads the data once if nothing was loaded yet (and the last attempt did not fail). */
  async ensureLoaded(): Promise<Snapshot | undefined> {
    if (this._snapshot || this._error !== undefined || !this.connection.isConfigured) {
      if (this.inflight && !this._snapshot) {
        await this.inflight;
      }
      return this._snapshot;
    }
    await this.refresh();
    return this._snapshot;
  }

  private async doRefresh(): Promise<void> {
    const client = this.connection.getClient();
    const generation = this.generation;
    if (!client) {
      this._snapshot = undefined;
      this._error = undefined;
      this.changeEmitter.fire();
      return;
    }
    try {
      const [servers, stacks, services, tags] = await Promise.all([
        client.read('ListServers', { limit: 0 }),
        client.read('ListStacks', { limit: 0 }),
        client.read('ListAllStackServices', { limit: 0 }),
        client.read('ListTags', {}).catch((err: unknown) => {
          this.log.debug(`ListTags failed: ${formatError(err)}`);
          return [] as Tag[];
        }),
      ]);
      if (!this._coreVersion) {
        const [version, info] = await Promise.all([
          client.version().catch(() => undefined),
          client.read('GetCoreInfo', {}).catch(() => undefined),
        ]);
        this._coreVersion = version;
        this._coreInfo = info;
      }
      if (generation !== this.generation) {
        return;
      }
      this._snapshot = buildSnapshot(servers, stacks, services, tags);
      this._error = undefined;
      this._authFailed = false;
      this.log.trace(`Refreshed: ${servers.length} servers, ${stacks.length} stacks, ${services.length} services.`);
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this._error = err;
      if (err instanceof KomodoApiError && err.isAuthError) {
        this._authFailed = true;
        this.log.error(
          `Komodo rejected the API credentials (${formatError(err)}). Automatic refresh is paused: run "Komodo: Configure Connection…" or refresh manually.`,
        );
      } else {
        this.log.warn(`Refresh failed: ${formatError(err)}`);
      }
    }
    this.changeEmitter.fire();
  }

  // ------------------------------------------------------------ lookups --

  server(id: string): ServerListItem | undefined {
    return this._snapshot?.serverById.get(id);
  }

  stack(id: string): StackListItem | undefined {
    return this._snapshot?.stackById.get(id);
  }

  stacksOnServer(serverId: string): readonly StackListItem[] {
    return this._snapshot?.stacksByServer.get(serverId) ?? [];
  }

  servicesOf(stackId: string): readonly StackService[] | undefined {
    return this._snapshot?.servicesByStack.get(stackId);
  }

  containerOwner(serverId: string, containerName: string): ContainerOwner | undefined {
    return this._snapshot?.containerOwners.get(`${serverId}/${containerName}`);
  }

  tagNames(tagIds: readonly string[]): string[] {
    const tags = this._snapshot?.tagsById;
    return tagIds.map((id) => tags?.get(id)?.name).filter((n): n is string => !!n);
  }

  /** Display name of an update target. */
  targetName(target: { type: string; id: string }): string {
    switch (target.type) {
      case 'Server':
        return this.server(target.id)?.name ?? `server ${target.id.slice(-6)}`;
      case 'Stack':
        return this.stack(target.id)?.name ?? `stack ${target.id.slice(-6)}`;
      case 'System':
        return 'System';
      default:
        return target.type;
    }
  }

  // --------------------------------------------------------------- busy --

  busyLabel(key: string): string | undefined {
    return this.busy.get(key);
  }

  setBusy(keys: readonly string[], label: string): void {
    for (const key of keys) {
      this.busy.set(key, label);
    }
    this.changeEmitter.fire();
  }

  clearBusy(keys: readonly string[]): void {
    for (const key of keys) {
      this.busy.delete(key);
    }
    this.changeEmitter.fire();
  }

  // ------------------------------------------------------------- filter --

  get filter(): string {
    return this._filter;
  }

  setFilter(value: string): void {
    this._filter = value.trim();
    void vscode.commands.executeCommand('setContext', 'komodo.filterActive', this._filter.length > 0);
    this.changeEmitter.fire();
  }

  /** True if every whitespace-separated filter term appears in the haystack. */
  matchesFilter(haystack: string): boolean {
    if (!this._filter) {
      return true;
    }
    const text = haystack.toLowerCase();
    return this._filter
      .toLowerCase()
      .split(/\s+/)
      .every((term) => text.includes(term));
  }

  // ------------------------------------------------------------ updates --

  get updates(): readonly UpdateListItem[] | undefined {
    return this._updates;
  }

  get updatesError(): unknown {
    return this._updatesError;
  }

  /** Loads the most recent updates (activity view). */
  loadUpdates(): Promise<void> {
    if (this.updatesInflight) {
      return this.updatesInflight;
    }
    const client = this.connection.getClient();
    if (!client || this._authFailed) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.updatesInflight = (async () => {
      try {
        const res = await client.read('ListUpdates', {});
        if (generation === this.generation) {
          this._updates = res.updates.slice(0, MAX_UPDATES);
          this._updatesError = undefined;
        }
      } catch (err) {
        if (generation === this.generation) {
          this._updatesError = err;
          this.log.warn(`Loading updates failed: ${formatError(err)}`);
        }
      } finally {
        this.updatesInflight = undefined;
        this.updatesEmitter.fire();
      }
    })();
    return this.updatesInflight;
  }

  async ensureUpdates(): Promise<readonly UpdateListItem[] | undefined> {
    if (!this._updates && this._updatesError === undefined) {
      await this.loadUpdates();
    }
    return this._updates;
  }

  /** Applies an update pushed by the websocket. */
  upsertUpdate(update: UpdateListItem): void {
    if (!this._updates) {
      return;
    }
    const index = this._updates.findIndex((u) => u.id === update.id);
    if (index >= 0) {
      this._updates[index] = update;
    } else {
      this._updates.unshift(update);
      this._updates.sort((a, b) => b.start_ts - a.start_ts);
      this._updates.length = Math.min(this._updates.length, MAX_UPDATES);
    }
    this.updatesEmitter.fire();
  }

  dispose(): void {
    clearTimeout(this.soonTimer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
