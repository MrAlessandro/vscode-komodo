import type { ExecuteRequests, ExecuteType } from '../api/types';

/**
 * - `safe`: does not interrupt running containers (start, unpause, pull).
 * - `disruptive`: interrupts or recreates containers (deploy, restart, stop, pause).
 * - `dangerous`: removes things or affects every container of a server.
 */
export type Severity = 'safe' | 'disruptive' | 'dangerous';

export type ActionKind = 'stack' | 'service' | 'container' | 'server';

export type ConfirmSetting = 'always' | 'disruptive' | 'dangerous' | 'never';

export interface ActionDef {
  command: string;
  kind: ActionKind;
  execute: ExecuteType;
  /** Imperative, e.g. `Restart`, `Pull images for`. */
  verb: string;
  /** Progressive, e.g. `Restarting`. */
  ing: string;
  /** Past, e.g. `Restarted`. */
  past: string;
  severity: Severity;
  /** One line explaining what happens, shown in confirmations. */
  explain: string;
  /** Label of the confirm button. Defaults to the verb. */
  confirmLabel?: string;
}

export const STACK_ACTIONS: readonly ActionDef[] = [
  {
    command: 'komodo.stack.deploy',
    kind: 'stack',
    execute: 'DeployStack',
    verb: 'Deploy',
    ing: 'Deploying',
    past: 'Deployed',
    severity: 'disruptive',
    explain: 'Komodo writes the compose files, pulls the images and runs `docker compose up -d`: changed services are recreated.',
  },
  {
    command: 'komodo.stack.deployIfChanged',
    kind: 'stack',
    execute: 'DeployStackIfChanged',
    verb: 'Deploy if changed',
    ing: 'Deploying (if changed)',
    past: 'Checked for changes and deployed',
    severity: 'disruptive',
    explain: 'Redeploys only if the compose files or the repository changed since the last deploy.',
    confirmLabel: 'Deploy if changed',
  },
  {
    command: 'komodo.stack.pull',
    kind: 'stack',
    execute: 'PullStack',
    verb: 'Pull images for',
    ing: 'Pulling images for',
    past: 'Pulled images for',
    severity: 'safe',
    explain: 'Runs `docker compose pull`. Running containers are not touched until the next deploy.',
    confirmLabel: 'Pull',
  },
  {
    command: 'komodo.stack.start',
    kind: 'stack',
    execute: 'StartStack',
    verb: 'Start',
    ing: 'Starting',
    past: 'Started',
    severity: 'safe',
    explain: 'Runs `docker compose start`.',
  },
  {
    command: 'komodo.stack.restart',
    kind: 'stack',
    execute: 'RestartStack',
    verb: 'Restart',
    ing: 'Restarting',
    past: 'Restarted',
    severity: 'disruptive',
    explain: 'Runs `docker compose restart`: every service is briefly unavailable.',
  },
  {
    command: 'komodo.stack.stop',
    kind: 'stack',
    execute: 'StopStack',
    verb: 'Stop',
    ing: 'Stopping',
    past: 'Stopped',
    severity: 'disruptive',
    explain: 'Runs `docker compose stop`: the stack stays down until it is started again.',
  },
  {
    command: 'komodo.stack.pause',
    kind: 'stack',
    execute: 'PauseStack',
    verb: 'Pause',
    ing: 'Pausing',
    past: 'Paused',
    severity: 'disruptive',
    explain: 'Runs `docker compose pause`: processes are frozen until unpaused.',
  },
  {
    command: 'komodo.stack.unpause',
    kind: 'stack',
    execute: 'UnpauseStack',
    verb: 'Unpause',
    ing: 'Unpausing',
    past: 'Unpaused',
    severity: 'safe',
    explain: 'Runs `docker compose unpause`.',
  },
  {
    command: 'komodo.stack.destroy',
    kind: 'stack',
    execute: 'DestroyStack',
    verb: 'Destroy',
    ing: 'Destroying',
    past: 'Destroyed',
    severity: 'dangerous',
    explain: 'Runs `docker compose down`: all containers of the stack are removed (named volumes are kept). Deploy to bring it back.',
  },
];

export const SERVICE_ACTIONS: readonly ActionDef[] = [
  {
    command: 'komodo.service.deploy',
    kind: 'service',
    execute: 'DeployStack',
    verb: 'Deploy',
    ing: 'Deploying',
    past: 'Deployed',
    severity: 'disruptive',
    explain: 'Deploys only the selected service(s): the image is pulled and the container recreated if needed (`docker compose up -d <service>`).',
  },
  {
    command: 'komodo.service.pull',
    kind: 'service',
    execute: 'PullStack',
    verb: 'Pull image for',
    ing: 'Pulling image for',
    past: 'Pulled image for',
    severity: 'safe',
    explain: 'Runs `docker compose pull <service>`. The running container is not touched until the next deploy.',
    confirmLabel: 'Pull',
  },
  {
    command: 'komodo.service.start',
    kind: 'service',
    execute: 'StartStack',
    verb: 'Start',
    ing: 'Starting',
    past: 'Started',
    severity: 'safe',
    explain: 'Runs `docker compose start <service>`.',
  },
  {
    command: 'komodo.service.restart',
    kind: 'service',
    execute: 'RestartStack',
    verb: 'Restart',
    ing: 'Restarting',
    past: 'Restarted',
    severity: 'disruptive',
    explain: 'Runs `docker compose restart <service>`.',
  },
  {
    command: 'komodo.service.stop',
    kind: 'service',
    execute: 'StopStack',
    verb: 'Stop',
    ing: 'Stopping',
    past: 'Stopped',
    severity: 'disruptive',
    explain: 'Runs `docker compose stop <service>`.',
  },
  {
    command: 'komodo.service.pause',
    kind: 'service',
    execute: 'PauseStack',
    verb: 'Pause',
    ing: 'Pausing',
    past: 'Paused',
    severity: 'disruptive',
    explain: 'Runs `docker compose pause <service>`.',
  },
  {
    command: 'komodo.service.unpause',
    kind: 'service',
    execute: 'UnpauseStack',
    verb: 'Unpause',
    ing: 'Unpausing',
    past: 'Unpaused',
    severity: 'safe',
    explain: 'Runs `docker compose unpause <service>`.',
  },
  {
    command: 'komodo.service.destroy',
    kind: 'service',
    execute: 'DestroyStack',
    verb: 'Destroy',
    ing: 'Destroying',
    past: 'Destroyed',
    severity: 'dangerous',
    explain: 'Stops and removes the service container (`docker compose down <service>`). Deploy the service to recreate it.',
  },
];

export const CONTAINER_ACTIONS: readonly ActionDef[] = [
  {
    command: 'komodo.container.start',
    kind: 'container',
    execute: 'StartContainer',
    verb: 'Start',
    ing: 'Starting',
    past: 'Started',
    severity: 'safe',
    explain: 'Runs `docker start`.',
  },
  {
    command: 'komodo.container.restart',
    kind: 'container',
    execute: 'RestartContainer',
    verb: 'Restart',
    ing: 'Restarting',
    past: 'Restarted',
    severity: 'disruptive',
    explain: 'Runs `docker restart`.',
  },
  {
    command: 'komodo.container.stop',
    kind: 'container',
    execute: 'StopContainer',
    verb: 'Stop',
    ing: 'Stopping',
    past: 'Stopped',
    severity: 'disruptive',
    explain: 'Runs `docker stop`.',
  },
  {
    command: 'komodo.container.pause',
    kind: 'container',
    execute: 'PauseContainer',
    verb: 'Pause',
    ing: 'Pausing',
    past: 'Paused',
    severity: 'disruptive',
    explain: 'Runs `docker pause`.',
  },
  {
    command: 'komodo.container.unpause',
    kind: 'container',
    execute: 'UnpauseContainer',
    verb: 'Unpause',
    ing: 'Unpausing',
    past: 'Unpaused',
    severity: 'safe',
    explain: 'Runs `docker unpause`.',
  },
  {
    command: 'komodo.container.destroy',
    kind: 'container',
    execute: 'DestroyContainer',
    verb: 'Destroy',
    ing: 'Destroying',
    past: 'Destroyed',
    severity: 'dangerous',
    explain: 'Stops and removes the container. Containers belonging to a stack come back with the next deploy.',
  },
];

export const SERVER_ACTIONS: readonly ActionDef[] = [
  {
    command: 'komodo.server.startAll',
    kind: 'server',
    execute: 'StartAllContainers',
    verb: 'Start all containers on',
    ing: 'Starting all containers on',
    past: 'Started all containers on',
    severity: 'disruptive',
    explain: 'Starts every stopped container on the server, including ones that were stopped on purpose.',
    confirmLabel: 'Start All',
  },
  {
    command: 'komodo.server.restartAll',
    kind: 'server',
    execute: 'RestartAllContainers',
    verb: 'Restart all containers on',
    ing: 'Restarting all containers on',
    past: 'Restarted all containers on',
    severity: 'dangerous',
    explain: 'Restarts every container on the server, including the ones of all its stacks.',
    confirmLabel: 'Restart All',
  },
  {
    command: 'komodo.server.stopAll',
    kind: 'server',
    execute: 'StopAllContainers',
    verb: 'Stop all containers on',
    ing: 'Stopping all containers on',
    past: 'Stopped all containers on',
    severity: 'dangerous',
    explain: 'Stops every container on the server: all of its stacks go down.',
    confirmLabel: 'Stop All',
  },
  {
    command: 'komodo.server.pauseAll',
    kind: 'server',
    execute: 'PauseAllContainers',
    verb: 'Pause all containers on',
    ing: 'Pausing all containers on',
    past: 'Paused all containers on',
    severity: 'dangerous',
    explain: 'Freezes every container on the server until unpaused.',
    confirmLabel: 'Pause All',
  },
  {
    command: 'komodo.server.unpauseAll',
    kind: 'server',
    execute: 'UnpauseAllContainers',
    verb: 'Unpause all containers on',
    ing: 'Unpausing all containers on',
    past: 'Unpaused all containers on',
    severity: 'safe',
    explain: 'Unpauses every paused container on the server.',
    confirmLabel: 'Unpause All',
  },
];

export interface PruneOption {
  execute: ExecuteType;
  label: string;
  detail: string;
}

/** Options for `komodo.server.prune`. Every prune is `dangerous`. */
export const PRUNE_OPTIONS: readonly PruneOption[] = [
  { execute: 'PruneImages', label: 'Images', detail: 'Remove unused images (`docker image prune -a -f`).' },
  { execute: 'PruneContainers', label: 'Containers', detail: 'Remove stopped containers (`docker container prune -f`).' },
  { execute: 'PruneNetworks', label: 'Networks', detail: 'Remove unused networks (`docker network prune -f`).' },
  { execute: 'PruneDockerBuilders', label: 'Builder cache', detail: 'Remove the build cache (`docker builder prune -a -f`).' },
  { execute: 'PruneBuildx', label: 'Buildx cache', detail: 'Remove the buildx cache (`docker buildx prune -a -f`).' },
  {
    execute: 'PruneVolumes',
    label: 'Volumes ⚠',
    detail: 'Remove unused volumes (`docker volume prune -a -f`). DATA IN UNUSED VOLUMES IS LOST.',
  },
  {
    execute: 'PruneSystem',
    label: 'System',
    detail: 'Remove stopped containers, unused networks, images and build cache (`docker system prune -a -f`).',
  },
];

/** The pseudo-action used when pruning a server (verb and labels are customised per prune option). */
export function pruneAction(option: PruneOption): ActionDef {
  const what = option.label.replace(/\s*⚠$/, '').toLowerCase();
  return {
    command: 'komodo.server.prune',
    kind: 'server',
    execute: option.execute,
    verb: `Prune ${what} on`,
    ing: `Pruning ${what} on`,
    past: `Pruned ${what} on`,
    severity: 'dangerous',
    explain: option.detail,
    confirmLabel: 'Prune',
  };
}

export const ALL_ACTIONS: readonly ActionDef[] = [
  ...STACK_ACTIONS,
  ...SERVICE_ACTIONS,
  ...CONTAINER_ACTIONS,
  ...SERVER_ACTIONS,
];

export function needsConfirmation(severity: Severity, setting: ConfirmSetting): boolean {
  switch (setting) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'dangerous':
      return severity === 'dangerous';
    default:
      return severity !== 'safe';
  }
}

// ------------------------------------------------------------- targets ---

export interface StackRef {
  kind: 'stack';
  stackId: string;
  stackName: string;
  serverName?: string;
}

export interface ServiceRef {
  kind: 'service';
  stackId: string;
  stackName: string;
  serverName?: string;
  services: string[];
}

export interface ContainerRef {
  kind: 'container';
  serverId: string;
  serverName: string;
  container: string;
}

export interface ServerRef {
  kind: 'server';
  serverId: string;
  serverName: string;
}

export type TargetRef = StackRef | ServiceRef | ContainerRef | ServerRef;

/** Builds the `/execute` params for an action on a target. Ids are used (not names) to stay unambiguous. */
export function buildParams(execute: ExecuteType, target: TargetRef): ExecuteRequests[ExecuteType] {
  switch (target.kind) {
    case 'stack':
      return { stack: target.stackId };
    case 'service':
      if (execute === 'DeployStackIfChanged') {
        return { stack: target.stackId };
      }
      return { stack: target.stackId, services: [...target.services] };
    case 'container':
      return { server: target.serverId, container: target.container };
    case 'server':
      return { server: target.serverId };
  }
}

/** Human description of a target, e.g. `stack “demeter”` or `services nginx, redis of stack “demeter”`. */
export function describeTarget(target: TargetRef): string {
  switch (target.kind) {
    case 'stack':
      return `stack “${target.stackName}”`;
    case 'service':
      return target.services.length === 1
        ? `service “${target.services[0]}” of stack “${target.stackName}”`
        : `services ${target.services.map((s) => `“${s}”`).join(', ')} of stack “${target.stackName}”`;
    case 'container':
      return `container “${target.container}” on “${target.serverName}”`;
    case 'server':
      return `server “${target.serverName}”`;
  }
}

/** Key used to show a spinner on the tree item while an action runs. */
export function busyKeys(target: TargetRef): string[] {
  switch (target.kind) {
    case 'stack':
      return [`stack:${target.stackId}`];
    case 'service':
      return target.services.map((s) => `service:${target.stackId}:${s}`);
    case 'container':
      return [`container:${target.serverId}:${target.container}`];
    case 'server':
      return [`server:${target.serverId}`];
  }
}
