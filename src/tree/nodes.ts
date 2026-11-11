import type * as vscode from 'vscode';
import type {
  ContainerListItem,
  ServerListItem,
  StackListItem,
  StackService,
  UpdateListItem,
} from '../api/types';
import type { Tone } from '../model/status';

export type ViewId = 'servers' | 'stacks' | 'activity';

export interface ServerNode {
  kind: 'server';
  view: ViewId;
  server: ServerListItem;
}

export interface StackNode {
  kind: 'stack';
  view: ViewId;
  stack: StackListItem;
}

export interface ServiceNode {
  kind: 'service';
  view: ViewId;
  stack: StackListItem;
  name: string;
  /** Runtime info; missing when Komodo has no container for the service. */
  service?: StackService;
  image?: string;
  updateAvailable: boolean;
  latestImage?: string;
}

export interface ContainersGroupNode {
  kind: 'containers';
  view: ViewId;
  server: ServerListItem;
}

export interface ContainerNode {
  kind: 'container';
  view: ViewId;
  server: ServerListItem;
  container: ContainerListItem;
  owner?: { stackId: string; stackName: string; service: string };
}

export interface UpdateNode {
  kind: 'update';
  view: ViewId;
  update: UpdateListItem;
}

export interface MessageNode {
  kind: 'message';
  view: ViewId;
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  tone?: Tone;
  command?: vscode.Command;
}

export type KomodoNode =
  | ServerNode
  | StackNode
  | ServiceNode
  | ContainersGroupNode
  | ContainerNode
  | UpdateNode
  | MessageNode;

const KINDS = new Set(['server', 'stack', 'service', 'containers', 'container', 'update', 'message']);

export function isKomodoNode(value: unknown): value is KomodoNode {
  return !!value && typeof value === 'object' && KINDS.has((value as { kind?: string }).kind ?? '');
}

/** Stable tree item id (keeps the expansion state across refreshes). */
export function nodeId(node: KomodoNode): string {
  switch (node.kind) {
    case 'server':
      return `${node.view}/server/${node.server.id}`;
    case 'stack':
      return `${node.view}/stack/${node.stack.id}`;
    case 'service':
      return `${node.view}/stack/${node.stack.id}/service/${node.name}`;
    case 'containers':
      return `${node.view}/server/${node.server.id}/containers`;
    case 'container':
      return `${node.view}/server/${node.server.id}/container/${node.container.name}`;
    case 'update':
      return `${node.view}/update/${node.update.id}`;
    case 'message':
      return `${node.view}/message/${node.id}`;
  }
}

export function nodeName(node: KomodoNode): string {
  switch (node.kind) {
    case 'server':
      return node.server.name;
    case 'stack':
      return node.stack.name;
    case 'service':
      return node.name;
    case 'containers':
      return node.server.name;
    case 'container':
      return node.container.name;
    case 'update':
      return node.update.operation;
    case 'message':
      return node.label;
  }
}

/** Builds the service nodes of a stack, merging runtime info with the image-update info of the stack. */
export function serviceNodes(view: ViewId, stack: StackListItem, runtime: readonly StackService[] | undefined): ServiceNode[] {
  const updates = new Map(stack.info.services.map((s) => [s.service, s]));
  const names = new Set<string>([...(runtime ?? []).map((s) => s.service), ...stack.info.services.map((s) => s.service)]);
  const byName = new Map((runtime ?? []).map((s) => [s.service, s]));
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const service = byName.get(name);
      const update = updates.get(name);
      return {
        kind: 'service' as const,
        view,
        stack,
        name,
        service,
        image: service?.image || update?.image,
        updateAvailable: update?.update_available ?? false,
        latestImage: update?.latest_image,
      };
    });
}
