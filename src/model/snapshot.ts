import type { ServerListItem, StackListItem, StackService, Tag } from '../api/types';

export interface ContainerOwner {
  stack: StackListItem;
  service: string;
}

export interface Snapshot {
  readonly servers: readonly ServerListItem[];
  readonly stacks: readonly StackListItem[];
  readonly fetchedAt: number;
  readonly serverById: ReadonlyMap<string, ServerListItem>;
  readonly stackById: ReadonlyMap<string, StackListItem>;
  readonly stacksByServer: ReadonlyMap<string, readonly StackListItem[]>;
  readonly servicesByStack: ReadonlyMap<string, readonly StackService[]>;
  readonly tagsById: ReadonlyMap<string, Tag>;
  /** `${serverId}/${containerName}` → the stack service owning that container. */
  readonly containerOwners: ReadonlyMap<string, ContainerOwner>;
}

/** Indexes the raw Komodo lists for fast lookups by the views. */
export function buildSnapshot(
  servers: ServerListItem[],
  stacks: StackListItem[],
  services: StackService[],
  tags: Tag[],
): Snapshot {
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const sortedServers = [...servers].sort(byName);
  const sortedStacks = [...stacks].sort(byName);
  const serverById = new Map(sortedServers.map((s) => [s.id, s]));
  const stackById = new Map(sortedStacks.map((s) => [s.id, s]));
  const stacksByServer = new Map<string, StackListItem[]>();
  for (const stack of sortedStacks) {
    const serverId = stack.info.server_id;
    if (!serverId) {
      continue;
    }
    const list = stacksByServer.get(serverId) ?? [];
    list.push(stack);
    stacksByServer.set(serverId, list);
  }
  const servicesByStack = new Map<string, StackService[]>();
  const containerOwners = new Map<string, ContainerOwner>();
  for (const service of services) {
    const list = servicesByStack.get(service.stack_id) ?? [];
    list.push(service);
    servicesByStack.set(service.stack_id, list);
    const stack = stackById.get(service.stack_id);
    const container = service.container;
    const serverId = container?.server_id ?? stack?.info.server_id;
    if (stack && container?.name && serverId) {
      containerOwners.set(`${serverId}/${container.name}`, { stack, service: service.service });
    }
  }
  for (const list of servicesByStack.values()) {
    list.sort((a, b) => a.service.localeCompare(b.service));
  }
  const tagsById = new Map<string, Tag>();
  for (const tag of tags) {
    const id = tag._id?.$oid;
    if (id) {
      tagsById.set(id, tag);
    }
  }
  return {
    servers: sortedServers,
    stacks: sortedStacks,
    fetchedAt: Date.now(),
    serverById,
    stackById,
    stacksByServer,
    servicesByStack,
    tagsById,
    containerOwners,
  };
}
