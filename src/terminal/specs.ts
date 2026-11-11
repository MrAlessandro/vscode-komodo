import type { ContainerRef, ServerRef } from '../actions/catalog';
import type { TerminalTarget } from '../api/types';

/** What to open: a shell on a server, or `exec` into a container / stack service. */
export interface TerminalSpec {
  /** VS Code terminal tab title. */
  title: string;
  /** Human description used in messages, e.g. `server “alpha”`. */
  description: string;
  target: TerminalTarget;
  /** Shell command (e.g. `bash`). Empty = Komodo default (Periphery config for servers, `sh` for containers). */
  command?: string;
}

function shell(command: string | undefined): string | undefined {
  const value = command?.trim();
  return value ? value : undefined;
}

export function serverTerminalSpec(ref: Pick<ServerRef, 'serverId' | 'serverName'>, command?: string): TerminalSpec {
  return {
    title: `Komodo: ${ref.serverName}`,
    description: `server “${ref.serverName}”`,
    target: { type: 'Server', params: { server: ref.serverId } },
    command: shell(command),
  };
}

export function serviceTerminalSpec(
  ref: { stackId: string; stackName: string },
  service: string,
  command?: string,
): TerminalSpec {
  return {
    title: `Komodo: ${ref.stackName}/${service}`,
    description: `service “${service}” of stack “${ref.stackName}”`,
    target: { type: 'Stack', params: { stack: ref.stackId, service } },
    command: shell(command),
  };
}

export function containerTerminalSpec(ref: Pick<ContainerRef, 'serverId' | 'serverName' | 'container'>, command?: string): TerminalSpec {
  return {
    title: `Komodo: ${ref.container}`,
    description: `container “${ref.container}” on “${ref.serverName}”`,
    target: { type: 'Container', params: { server: ref.serverId, container: ref.container } },
    command: shell(command),
  };
}

/** Unique Komodo session name, so every VS Code terminal gets its own shell. */
export function newSessionName(now: number = Date.now()): string {
  return `vscode-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
