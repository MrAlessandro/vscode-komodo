import * as vscode from 'vscode';
import { KomodoApiError, formatError } from '../api/client';
import type { ServerListItem, StackListItem } from '../api/types';
import { getSettings } from '../config';
import type { ConnectionManager } from '../connection';
import type { KomodoStore, Snapshot } from '../model/store';
import { serviceNodes, type KomodoNode, type MessageNode, type ViewId } from './nodes';
import { renderNode } from './render';

abstract class BaseProvider implements vscode.TreeDataProvider<KomodoNode>, vscode.Disposable {
  protected readonly emitter = new vscode.EventEmitter<KomodoNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  protected readonly disposables: vscode.Disposable[] = [this.emitter];

  constructor(
    protected readonly store: KomodoStore,
    protected readonly connection: ConnectionManager,
    protected readonly view: ViewId,
  ) {}

  getTreeItem(node: KomodoNode): vscode.TreeItem {
    return renderNode(node, this.store, getSettings());
  }

  abstract getChildren(node?: KomodoNode): vscode.ProviderResult<KomodoNode[]>;

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Root-level message shown when the data could not be loaded. */
  protected errorNodes(error: unknown): MessageNode[] {
    const auth = error instanceof KomodoApiError && error.isAuthError;
    const nodes: MessageNode[] = [
      {
        kind: 'message',
        view: this.view,
        id: 'error',
        label: auth ? 'Komodo rejected the API key' : 'Cannot load data from Komodo',
        description: formatError(error),
        tooltip: formatError(error),
        icon: 'error',
        tone: 'error',
      },
      {
        kind: 'message',
        view: this.view,
        id: 'retry',
        label: 'Retry',
        icon: 'refresh',
        command: { command: 'komodo.refresh', title: 'Retry' },
      },
    ];
    if (auth) {
      nodes.push({
        kind: 'message',
        view: this.view,
        id: 'configure',
        label: 'Configure connection…',
        icon: 'plug',
        command: { command: 'komodo.configure', title: 'Configure Connection' },
      });
    }
    return nodes;
  }

  protected emptyFilterNode(what: string): MessageNode {
    return {
      kind: 'message',
      view: this.view,
      id: 'no-match',
      label: `No ${what} match “${this.store.filter}”`,
      icon: 'filter',
      command: { command: 'komodo.clearFilter', title: 'Clear Filter' },
      description: 'click to clear the filter',
    };
  }

  protected async rootSnapshot(): Promise<Snapshot | MessageNode[] | undefined> {
    if (!this.connection.isConfigured) {
      return undefined;
    }
    const snapshot = await this.store.ensureLoaded();
    if (!snapshot) {
      return this.store.error !== undefined ? this.errorNodes(this.store.error) : [];
    }
    return snapshot;
  }

  protected stackHaystack(stack: StackListItem, snapshot: Snapshot): string {
    const services = snapshot.servicesByStack.get(stack.id)?.map((s) => s.service) ?? stack.info.services.map((s) => s.service);
    return [stack.name, stack.info.server_name ?? '', ...services, ...this.store.tagNames(stack.tags)].join(' ');
  }
}

/** Servers → stacks → services, plus a lazy "Containers" folder per server. */
export class ServersProvider extends BaseProvider {
  constructor(store: KomodoStore, connection: ConnectionManager) {
    super(store, connection, 'servers');
    this.disposables.push(store.onDidChange(() => this.emitter.fire()));
  }

  async getChildren(node?: KomodoNode): Promise<KomodoNode[]> {
    if (!node) {
      const root = await this.rootSnapshot();
      if (!root) {
        return [];
      }
      if (Array.isArray(root)) {
        return root;
      }
      const servers = root.servers.filter((server) => this.store.matchesFilter(this.serverHaystack(server, root)));
      if (!servers.length && this.store.filter) {
        return [this.emptyFilterNode('servers')];
      }
      return servers.map((server) => ({ kind: 'server', view: 'servers', server }));
    }
    switch (node.kind) {
      case 'server': {
        const children: KomodoNode[] = this.store
          .stacksOnServer(node.server.id)
          .map((stack) => ({ kind: 'stack', view: 'servers', stack }));
        if (node.server.info.state === 'Ok' && getSettings().serversShowContainers) {
          children.push({ kind: 'containers', view: 'servers', server: node.server });
        }
        return children;
      }
      case 'stack':
        return serviceNodes('servers', node.stack, this.store.servicesOf(node.stack.id));
      case 'containers':
        return this.containers(node.server);
      default:
        return [];
    }
  }

  private serverHaystack(server: ServerListItem, snapshot: Snapshot): string {
    const stacks = snapshot.stacksByServer.get(server.id) ?? [];
    return [server.name, ...this.store.tagNames(server.tags), ...stacks.map((s) => this.stackHaystack(s, snapshot))].join(' ');
  }

  private async containers(server: ServerListItem): Promise<KomodoNode[]> {
    const client = this.connection.getClient();
    if (!client) {
      return [];
    }
    try {
      const containers = await client.read('ListContainers', { server: server.id });
      if (!containers.length) {
        return [{ kind: 'message', view: 'servers', id: `${server.id}/no-containers`, label: 'No containers', icon: 'info' }];
      }
      return [...containers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((container) => {
          const owner = this.store.containerOwner(server.id, container.name);
          return {
            kind: 'container' as const,
            view: 'servers' as const,
            server,
            container,
            owner: owner ? { stackId: owner.stack.id, stackName: owner.stack.name, service: owner.service } : undefined,
          };
        });
    } catch (err) {
      return [
        {
          kind: 'message',
          view: 'servers',
          id: `${server.id}/containers-error`,
          label: 'Cannot list containers',
          description: formatError(err),
          tooltip: formatError(err),
          icon: 'error',
          tone: 'error',
        },
      ];
    }
  }
}

/** Flat list of stacks → services. */
export class StacksProvider extends BaseProvider {
  constructor(store: KomodoStore, connection: ConnectionManager) {
    super(store, connection, 'stacks');
    this.disposables.push(store.onDidChange(() => this.emitter.fire()));
  }

  async getChildren(node?: KomodoNode): Promise<KomodoNode[]> {
    if (!node) {
      const root = await this.rootSnapshot();
      if (!root) {
        return [];
      }
      if (Array.isArray(root)) {
        return root;
      }
      const stacks = root.stacks.filter((stack) => this.store.matchesFilter(this.stackHaystack(stack, root)));
      if (!stacks.length && this.store.filter) {
        return [this.emptyFilterNode('stacks')];
      }
      if (!stacks.length) {
        return [{ kind: 'message', view: 'stacks', id: 'empty', label: 'No stacks in this Komodo instance', icon: 'info' }];
      }
      return stacks.map((stack) => ({ kind: 'stack', view: 'stacks', stack }));
    }
    if (node.kind === 'stack') {
      return serviceNodes('stacks', node.stack, this.store.servicesOf(node.stack.id));
    }
    return [];
  }
}

const MAX_ACTIVITY = 50;

/** Most recent Komodo updates (executions), live-updated from the websocket. */
export class ActivityProvider extends BaseProvider {
  constructor(store: KomodoStore, connection: ConnectionManager) {
    super(store, connection, 'activity');
    this.disposables.push(
      store.onDidChangeUpdates(() => this.emitter.fire()),
      // Target names come from the snapshot.
      store.onDidChange(() => this.emitter.fire()),
    );
  }

  async getChildren(node?: KomodoNode): Promise<KomodoNode[]> {
    if (node || !this.connection.isConfigured) {
      return [];
    }
    const updates = await this.store.ensureUpdates();
    if (!updates) {
      return this.store.updatesError !== undefined ? this.errorNodes(this.store.updatesError) : [];
    }
    if (!updates.length) {
      return [{ kind: 'message', view: 'activity', id: 'empty', label: 'No updates yet', icon: 'info' }];
    }
    return updates.slice(0, MAX_ACTIVITY).map((update) => ({ kind: 'update', view: 'activity', update }));
  }
}
