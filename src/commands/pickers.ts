import * as vscode from 'vscode';
import { formatError } from '../api/client';
import type { ContainerListItem, ServerListItem, StackListItem } from '../api/types';
import type { ConnectionManager } from '../connection';
import { containerPresentation, serverPresentation, servicePresentation, stackPresentation } from '../model/status';
import type { KomodoStore } from '../model/store';

/** Quick picks used when a command is run from the Command Palette (no tree item selected). */

async function snapshotOrWarn(store: KomodoStore) {
  const snapshot = await store.ensureLoaded();
  if (!snapshot) {
    void vscode.window.showWarningMessage(
      store.error !== undefined ? `Komodo: ${formatError(store.error)}` : 'Komodo: configure a connection first.',
    );
  }
  return snapshot;
}

export async function pickServers(store: KomodoStore, title: string, canPickMany = false): Promise<ServerListItem[]> {
  const snapshot = await snapshotOrWarn(store);
  if (!snapshot) {
    return [];
  }
  const items = snapshot.servers.map((server) => ({
    label: `$(${serverPresentation(server).icon}) ${server.name}`,
    description: serverPresentation(server).label,
    detail: store.stacksOnServer(server.id).map((s) => s.name).join(', ') || undefined,
    server,
  }));
  return pick(items, title, canPickMany, (i) => i.server);
}

export async function pickStacks(store: KomodoStore, title: string, canPickMany = false): Promise<StackListItem[]> {
  const snapshot = await snapshotOrWarn(store);
  if (!snapshot) {
    return [];
  }
  const items = snapshot.stacks.map((stack) => ({
    label: `$(${stackPresentation(stack, store.servicesOf(stack.id)).icon}) ${stack.name}`,
    description: [stack.info.server_name, stack.info.status].filter(Boolean).join(' · '),
    stack,
  }));
  return pick(items, title, canPickMany, (i) => i.stack);
}

export interface PickedService {
  stack: StackListItem;
  service: string;
}

export async function pickServices(store: KomodoStore, title: string, canPickMany = false): Promise<PickedService[]> {
  const snapshot = await snapshotOrWarn(store);
  if (!snapshot) {
    return [];
  }
  const items = snapshot.stacks.flatMap((stack) => {
    const runtime = new Map((store.servicesOf(stack.id) ?? []).map((s) => [s.service, s]));
    const names = new Set([...runtime.keys(), ...stack.info.services.map((s) => s.service)]);
    return [...names].sort().map((service) => {
      const presentation = servicePresentation(runtime.get(service));
      return {
        label: `$(${presentation.icon}) ${service}`,
        description: `${stack.name}${stack.info.server_name ? ` · ${stack.info.server_name}` : ''}`,
        detail: runtime.get(service)?.container?.status,
        value: { stack, service },
      };
    });
  });
  return pick(items, title, canPickMany, (i) => i.value);
}

export async function pickContainer(
  store: KomodoStore,
  connection: ConnectionManager,
  title: string,
): Promise<{ server: ServerListItem; container: ContainerListItem } | undefined> {
  const [server] = await pickServers(store, `${title}: choose the server`);
  const client = connection.getClient();
  if (!server || !client) {
    return undefined;
  }
  let containers: ContainerListItem[];
  try {
    containers = await client.read('ListContainers', { server: server.id });
  } catch (err) {
    void vscode.window.showErrorMessage(`Komodo: cannot list containers on ${server.name}: ${formatError(err)}`);
    return undefined;
  }
  const items = [...containers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((container) => ({
      label: `$(${containerPresentation(container).icon}) ${container.name}`,
      description: container.status,
      detail: container.image,
      container,
    }));
  const [container] = await pick(items, `${title}: choose the container`, false, (i) => i.container);
  return container ? { server, container } : undefined;
}

async function pick<I extends vscode.QuickPickItem, R>(
  items: I[],
  title: string,
  canPickMany: boolean,
  map: (item: I) => R,
): Promise<R[]> {
  if (!items.length) {
    void vscode.window.showInformationMessage(`Komodo: nothing to choose from (${title}).`);
    return [];
  }
  if (canPickMany) {
    const picked = await vscode.window.showQuickPick(items, { title, canPickMany: true, matchOnDescription: true, matchOnDetail: true });
    return (picked ?? []).map(map);
  }
  const picked = await vscode.window.showQuickPick(items, { title, matchOnDescription: true, matchOnDetail: true });
  return picked ? [map(picked)] : [];
}
