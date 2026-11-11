import * as vscode from 'vscode';
import {
  CONTAINER_ACTIONS,
  PRUNE_OPTIONS,
  SERVER_ACTIONS,
  SERVICE_ACTIONS,
  STACK_ACTIONS,
  pruneAction,
  type ContainerRef,
  type ServerRef,
  type ServiceRef,
  type StackRef,
} from '../actions/catalog';
import type { ActionRunner } from '../actions/runner';
import { formatError } from '../api/client';
import type { StackListItem } from '../api/types';
import { getSettings } from '../config';
import type { ConnectionManager } from '../connection';
import { composeFiles, type KomodoDocumentProvider } from '../documents/provider';
import type { KomodoStore } from '../model/store';
import type { TerminalManager } from '../terminal/komodoTerminal';
import { containerTerminalSpec, serverTerminalSpec, serviceTerminalSpec, type TerminalSpec } from '../terminal/specs';
import { isKomodoNode, nodeId, nodeName, type KomodoNode } from '../tree/nodes';
import type { StatsPanelManager } from '../webview/statsPanel';
import { pickContainer, pickServers, pickServices, pickStacks } from './pickers';

export interface CommandDeps {
  context: vscode.ExtensionContext;
  store: KomodoStore;
  connection: ConnectionManager;
  runner: ActionRunner;
  docs: KomodoDocumentProvider;
  stats: StatsPanelManager;
  terminals: TerminalManager;
  log: vscode.LogOutputChannel;
}

const CUSTOM_SHELL = '\u0000custom';

/** Asks which shell to start. Resolves to `''` for the Periphery default, `undefined` when cancelled. */
async function pickShell(server: boolean): Promise<string | undefined> {
  const items: (vscode.QuickPickItem & { value: string })[] = server
    ? [
        { label: 'Default', description: 'shell configured on Periphery', value: '' },
        { label: 'bash', value: 'bash' },
        { label: 'sh', value: 'sh' },
        { label: 'zsh', value: 'zsh' },
        { label: 'Custom…', description: 'any command, e.g. "bash -l" or "htop"', value: CUSTOM_SHELL },
      ]
    : [
        { label: 'sh', description: 'available in almost every image', value: 'sh' },
        { label: 'bash', value: 'bash' },
        { label: 'ash', description: 'Alpine / BusyBox', value: 'ash' },
        { label: 'Custom…', description: 'any command, e.g. "python3" or "psql -U postgres"', value: CUSTOM_SHELL },
      ];
  const picked = await vscode.window.showQuickPick(items, { title: 'Komodo: Open Terminal With Shell', placeHolder: 'Shell to start' });
  if (!picked) {
    return undefined;
  }
  if (picked.value !== CUSTOM_SHELL) {
    return picked.value;
  }
  const custom = await vscode.window.showInputBox({
    title: 'Komodo: Open Terminal With Shell',
    prompt: 'Command to start in the terminal',
    placeHolder: server ? 'bash -l' : 'sh',
    validateInput: (value) => (value.trim() ? undefined : 'Enter a command.'),
  });
  return custom?.trim() || undefined;
}

/**
 * Nodes targeted by a tree command: the whole multi-selection when the clicked
 * node is part of it (same kind only), otherwise just the clicked node.
 */
export function selectedNodes(node: unknown, nodes: unknown): KomodoNode[] {
  if (!isKomodoNode(node)) {
    return [];
  }
  if (Array.isArray(nodes) && nodes.length > 1 && nodes.some((n) => isKomodoNode(n) && nodeId(n) === nodeId(node))) {
    return nodes.filter(isKomodoNode).filter((n) => n.kind === node.kind);
  }
  return [node];
}

const RESOURCE_PATHS: Partial<Record<string, string>> = {
  Server: 'servers',
  Stack: 'stacks',
  Deployment: 'deployments',
  Build: 'builds',
  Repo: 'repos',
  Procedure: 'procedures',
  Action: 'actions',
  Builder: 'builders',
  Alerter: 'alerters',
  ResourceSync: 'resource-syncs',
  Swarm: 'swarms',
};

/** Komodo web UI URL for a tree node. */
export function webUrl(base: string, node: KomodoNode | undefined): string {
  if (!node) {
    return base;
  }
  switch (node.kind) {
    case 'server':
    case 'containers':
      return `${base}/servers/${node.server.id}`;
    case 'stack':
      return `${base}/stacks/${node.stack.id}`;
    case 'service':
      return `${base}/stacks/${node.stack.id}/service/${encodeURIComponent(node.name)}`;
    case 'container':
      return `${base}/servers/${node.server.id}/container/${encodeURIComponent(node.container.name)}`;
    case 'update': {
      const path = RESOURCE_PATHS[node.update.target.type];
      return path ? `${base}/${path}/${node.update.target.id}` : base;
    }
    default:
      return base;
  }
}

function stackRef(stack: StackListItem): StackRef {
  return { kind: 'stack', stackId: stack.id, stackName: stack.name, serverName: stack.info.server_name };
}

export function registerCommands(deps: CommandDeps): void {
  const { context, store, connection, runner, docs, stats, terminals, log } = deps;

  const register = (id: string, handler: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (err) {
          log.error(`${id} failed: ${formatError(err)}`);
          void vscode.window.showErrorMessage(`Komodo: ${formatError(err)}`);
          return undefined;
        }
      }),
    );
  };

  // ------------------------------------------------------- resolution --

  const stackRefs = async (node: unknown, nodes: unknown, title: string): Promise<StackRef[]> => {
    if (isKomodoNode(node)) {
      return selectedNodes(node, nodes).flatMap((n) => (n.kind === 'stack' ? [stackRef(n.stack)] : []));
    }
    return (await pickStacks(store, title, true)).map(stackRef);
  };

  const serviceRefs = async (node: unknown, nodes: unknown, title: string): Promise<ServiceRef[]> => {
    let pairs: { stack: StackListItem; service: string }[];
    if (isKomodoNode(node)) {
      pairs = selectedNodes(node, nodes).flatMap((n) => (n.kind === 'service' ? [{ stack: n.stack, service: n.name }] : []));
    } else {
      pairs = await pickServices(store, title, true);
    }
    const groups = new Map<string, ServiceRef>();
    for (const { stack, service } of pairs) {
      const group = groups.get(stack.id) ?? {
        kind: 'service' as const,
        stackId: stack.id,
        stackName: stack.name,
        serverName: stack.info.server_name,
        services: [],
      };
      if (!group.services.includes(service)) {
        group.services.push(service);
      }
      groups.set(stack.id, group);
    }
    return [...groups.values()];
  };

  const containerRefs = async (node: unknown, nodes: unknown, title: string): Promise<ContainerRef[]> => {
    if (isKomodoNode(node)) {
      return selectedNodes(node, nodes).flatMap((n) =>
        n.kind === 'container'
          ? [{ kind: 'container' as const, serverId: n.server.id, serverName: n.server.name, container: n.container.name }]
          : [],
      );
    }
    const picked = await pickContainer(store, connection, title);
    return picked
      ? [{ kind: 'container', serverId: picked.server.id, serverName: picked.server.name, container: picked.container.name }]
      : [];
  };

  const serverRefs = async (node: unknown, nodes: unknown, title: string, canPickMany = true): Promise<ServerRef[]> => {
    if (isKomodoNode(node)) {
      return selectedNodes(node, nodes).flatMap((n) =>
        n.kind === 'server' ? [{ kind: 'server' as const, serverId: n.server.id, serverName: n.server.name }] : [],
      );
    }
    return (await pickServers(store, title, canPickMany)).map((s) => ({ kind: 'server', serverId: s.id, serverName: s.name }));
  };

  // ----------------------------------------------------------- general --

  register('komodo.configure', () => connection.configure());
  register('komodo.importFromEnvironment', () => connection.importFromEnvironment());
  register('komodo.signOut', () => connection.signOut());
  register('komodo.refresh', async () => {
    await Promise.all([store.refresh({ force: true }), store.loadUpdates()]);
    if (store.error !== undefined) {
      void vscode.window.showWarningMessage(`Komodo: refresh failed: ${formatError(store.error)}`);
    }
  });
  register('komodo.filter', async () => {
    const value = await vscode.window.showInputBox({
      title: 'Komodo: Filter',
      prompt: 'Show only servers / stacks whose name, services, server or tags contain all these words',
      placeHolder: 'e.g. wello staging',
      value: store.filter,
    });
    if (value !== undefined) {
      store.setFilter(value);
    }
  });
  register('komodo.clearFilter', () => store.setFilter(''));
  register('komodo.showOutput', () => log.show());
  register('komodo.openDashboard', () => {
    if (connection.url) {
      return vscode.env.openExternal(vscode.Uri.parse(connection.url));
    }
    return vscode.commands.executeCommand('komodo.configure');
  });
  register('komodo.openInBrowser', (node) => {
    if (!connection.url) {
      return undefined;
    }
    return vscode.env.openExternal(vscode.Uri.parse(webUrl(connection.url, isKomodoNode(node) ? node : undefined)));
  });
  register('komodo.copyName', async (node) => {
    if (isKomodoNode(node)) {
      await vscode.env.clipboard.writeText(nodeName(node));
      vscode.window.setStatusBarMessage(`$(copy) Copied “${nodeName(node)}”`, 2500);
    }
  });

  // ----------------------------------------------------------- actions --

  for (const def of STACK_ACTIONS) {
    register(def.command, async (node, nodes) => {
      await runner.run(def, await stackRefs(node, nodes, `${def.verb} stack`));
    });
  }
  for (const def of SERVICE_ACTIONS) {
    register(def.command, async (node, nodes) => {
      await runner.run(def, await serviceRefs(node, nodes, `${def.verb} service`));
    });
  }
  for (const def of CONTAINER_ACTIONS) {
    register(def.command, async (node, nodes) => {
      await runner.run(def, await containerRefs(node, nodes, `${def.verb} container`));
    });
  }
  for (const def of SERVER_ACTIONS) {
    register(def.command, async (node, nodes) => {
      await runner.run(def, await serverRefs(node, nodes, `${def.verb} server`));
    });
  }

  register('komodo.server.pullStacks', async (node, nodes) => {
    const servers = await serverRefs(node, nodes, 'Pull images of all stacks on server');
    const stacks = servers.flatMap((s) => store.stacksOnServer(s.serverId));
    if (!servers.length) {
      return;
    }
    if (!stacks.length) {
      void vscode.window.showInformationMessage(`Komodo: no stacks on ${servers.map((s) => s.serverName).join(', ')}.`);
      return;
    }
    const pull = STACK_ACTIONS.find((a) => a.execute === 'PullStack')!;
    await runner.run(pull, stacks.map(stackRef));
  });

  register('komodo.server.prune', async (node, nodes) => {
    const servers = await serverRefs(node, nodes, 'Prune Docker resources on server');
    if (!servers.length) {
      return;
    }
    const picked = await vscode.window.showQuickPick(
      PRUNE_OPTIONS.map((option) => ({ label: option.label, detail: option.detail, option })),
      {
        title: `Komodo: Prune on ${servers.map((s) => s.serverName).join(', ')}`,
        placeHolder: 'Select what to prune',
        canPickMany: true,
      },
    );
    if (!picked?.length) {
      return;
    }
    const what = picked.map((p) => p.option.label.replace(/\s*⚠$/, '').toLowerCase()).join(', ');
    const summary = {
      ...pruneAction(picked[0].option),
      verb: `Prune ${what} on`,
      explain: picked.map((p) => `• ${p.option.label}: ${p.option.detail}`).join('\n'),
    };
    if (!(await runner.confirm(summary, servers))) {
      return;
    }
    for (const p of picked) {
      await runner.run(pruneAction(p.option), servers, { confirmed: true });
    }
  });

  register('komodo.server.showStats', async (node, nodes) => {
    const servers = await serverRefs(node, nodes, 'Show stats for server', false);
    for (const server of servers) {
      stats.show(server.serverId);
    }
  });

  // ------------------------------------------------- logs / documents --

  register('komodo.stack.logs', async (node, nodes) => {
    for (const ref of await stackRefs(node, nodes, 'Show logs of stack')) {
      await docs.open({ kind: 'stackLog', stackId: ref.stackId, stackName: ref.stackName, services: [] });
    }
  });

  register('komodo.service.logs', async (node, nodes) => {
    for (const ref of await serviceRefs(node, nodes, 'Show logs of service')) {
      await docs.open({ kind: 'stackLog', stackId: ref.stackId, stackName: ref.stackName, services: ref.services });
    }
  });

  register('komodo.container.logs', async (node, nodes) => {
    for (const ref of await containerRefs(node, nodes, 'Show logs of container')) {
      await docs.open({ kind: 'containerLog', serverId: ref.serverId, serverName: ref.serverName, container: ref.container });
    }
  });

  register('komodo.service.inspect', async (node, nodes) => {
    const [ref] = await serviceRefs(node, nodes, 'Inspect service container');
    if (ref) {
      await docs.open({ kind: 'serviceInspect', stackId: ref.stackId, stackName: ref.stackName, service: ref.services[0] });
    }
  });

  register('komodo.container.inspect', async (node, nodes) => {
    const [ref] = await containerRefs(node, nodes, 'Inspect container');
    if (ref) {
      await docs.open({ kind: 'containerInspect', serverId: ref.serverId, serverName: ref.serverName, container: ref.container });
    }
  });

  register('komodo.stack.compose', async (node, nodes) => {
    const [ref] = await stackRefs(node, nodes, 'Show compose file of stack');
    const client = connection.getClient();
    if (!ref || !client) {
      return;
    }
    const stack = await client.read('GetStack', { stack: ref.stackId });
    const files = composeFiles(stack);
    if (!files.length) {
      void vscode.window.showInformationMessage(`Komodo: stack “${ref.stackName}” has no compose file available yet.`);
      return;
    }
    let file = files[0];
    if (files.length > 1) {
      const picked = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.path, file: f })),
        { title: `Compose files of ${ref.stackName}` },
      );
      if (!picked) {
        return;
      }
      file = picked.file;
    }
    await docs.open({ kind: 'compose', stackId: ref.stackId, stackName: ref.stackName, file: file.path });
  });

  register('komodo.update.open', async (node) => {
    if (isKomodoNode(node) && node.kind === 'update') {
      const update = node.update;
      await docs.open({
        kind: 'update',
        id: update.id,
        title: `${update.operation}-${store.targetName(update.target)}-${update.id.slice(-6)}`,
      });
    }
  });

  // -------------------------------------------------------- terminals --

  const serverTerminals = async (node: unknown, nodes: unknown, shell: string): Promise<TerminalSpec[]> =>
    (await serverRefs(node, nodes, 'Open terminal on server', false)).map((ref) => serverTerminalSpec(ref, shell));
  const serviceTerminals = async (node: unknown, nodes: unknown, shell: string): Promise<TerminalSpec[]> =>
    (await serviceRefs(node, nodes, 'Open terminal in service')).flatMap((ref) =>
      ref.services.map((service) => serviceTerminalSpec(ref, service, shell)),
    );
  const containerTerminals = async (node: unknown, nodes: unknown, shell: string): Promise<TerminalSpec[]> =>
    (await containerRefs(node, nodes, 'Open terminal in container')).map((ref) => containerTerminalSpec(ref, shell));

  const openTerminals = (specs: TerminalSpec[]) => {
    for (const spec of specs) {
      terminals.openTerminal(spec);
    }
  };

  register('komodo.server.terminal', async (node, nodes) =>
    openTerminals(await serverTerminals(node, nodes, getSettings().terminalServerShell)),
  );
  register('komodo.service.terminal', async (node, nodes) =>
    openTerminals(await serviceTerminals(node, nodes, getSettings().terminalContainerShell)),
  );
  register('komodo.container.terminal', async (node, nodes) =>
    openTerminals(await containerTerminals(node, nodes, getSettings().terminalContainerShell)),
  );
  register('komodo.terminal.openWithShell', async (node, nodes) => {
    if (!isKomodoNode(node) || !['server', 'service', 'container'].includes(node.kind)) {
      return;
    }
    const shell = await pickShell(node.kind === 'server');
    if (shell === undefined) {
      return;
    }
    if (node.kind === 'server') {
      openTerminals(await serverTerminals(node, nodes, shell));
    } else if (node.kind === 'service') {
      openTerminals(await serviceTerminals(node, nodes, shell));
    } else {
      openTerminals(await containerTerminals(node, nodes, shell));
    }
  });

  const activeUri = (arg: unknown) =>
    arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  register('komodo.logs.refresh', (uri) => docs.refresh(activeUri(uri)));
  register('komodo.logs.follow', (uri) => docs.follow(activeUri(uri)));
  register('komodo.logs.unfollow', (uri) => docs.unfollow(activeUri(uri)));
}
