import type {
  ContainerListItem,
  ServerListItem,
  ServerListItemInfo,
  StackListItem,
  StackService,
  UpdateStatus,
} from '../api/types';
import { parseExitCode, parseHealth, percent } from './format';

/** Colour semantics, mapped to theme colours by the tree views. */
export type Tone = 'ok' | 'warn' | 'critical' | 'error' | 'info' | 'muted';

export interface Presentation {
  /** Codicon id, optionally with `~spin`. */
  icon: string;
  tone: Tone;
  label: string;
}

export type Level = 'ok' | 'warning' | 'critical';

export interface ServerHealth {
  level: Level;
  reasons: string[];
  cpu?: number;
  mem?: number;
  disk?: number;
}

const DEFAULT_THRESHOLDS = {
  cpu_warning: 90,
  cpu_critical: 99,
  mem_warning: 75,
  mem_critical: 95,
  disk_warning: 75,
  disk_critical: 95,
};

/** Evaluates the server stats against its Komodo alerting thresholds. */
export function serverHealth(info: ServerListItemInfo): ServerHealth {
  const stats = info.stats;
  if (!stats) {
    return { level: 'ok', reasons: [] };
  }
  const t = info.alerting_thresholds ?? DEFAULT_THRESHOLDS;
  const cpu = stats.cpu_perc;
  const mem = percent(stats.mem_used_gb, stats.mem_total_gb);
  const disk = percent(stats.disk_used_gb, stats.disk_total_gb);
  const reasons: string[] = [];
  let level: Level = 'ok';
  const check = (name: string, value: number | undefined, warning: number, critical: number) => {
    if (value === undefined) {
      return;
    }
    if (value >= critical) {
      level = 'critical';
      reasons.push(`${name} critical`);
    } else if (value >= warning) {
      if (level === 'ok') {
        level = 'warning';
      }
      reasons.push(`${name} high`);
    }
  };
  check('CPU', cpu, t.cpu_warning, t.cpu_critical);
  check('memory', mem, t.mem_warning, t.mem_critical);
  check('disk', disk, t.disk_warning, t.disk_critical);
  return { level, reasons, cpu, mem, disk };
}

export function serverPresentation(server: ServerListItem): Presentation {
  switch (server.info.state) {
    case 'NotOk':
      return { icon: 'server-environment', tone: 'error', label: 'Unreachable' };
    case 'Disabled':
      return { icon: 'server-environment', tone: 'muted', label: 'Disabled' };
    default: {
      const health = serverHealth(server.info);
      if (health.level === 'critical') {
        return { icon: 'server-environment', tone: 'critical', label: capitalize(health.reasons.join(', ')) };
      }
      if (health.level === 'warning') {
        return { icon: 'server-environment', tone: 'warn', label: capitalize(health.reasons.join(', ')) };
      }
      return { icon: 'server-environment', tone: 'ok', label: 'OK' };
    }
  }
}

export interface ServiceProblems {
  unhealthy: number;
  failed: number;
  restarting: number;
  total: number;
}

/** Counts containers needing attention inside a stack. */
export function serviceProblems(services: readonly StackService[] | undefined): ServiceProblems {
  const result: ServiceProblems = { unhealthy: 0, failed: 0, restarting: 0, total: services?.length ?? 0 };
  for (const service of services ?? []) {
    const container = service.container;
    if (!container) {
      continue;
    }
    if (container.state === 'running' && parseHealth(container.status) === 'unhealthy') {
      result.unhealthy++;
    } else if (container.state === 'restarting') {
      result.restarting++;
    } else if (container.state === 'dead' || (container.state === 'exited' && (parseExitCode(container.status) ?? 0) !== 0)) {
      result.failed++;
    }
  }
  return result;
}

export function describeProblems(problems: ServiceProblems): string | undefined {
  const parts: string[] = [];
  if (problems.unhealthy) {
    parts.push(`${problems.unhealthy} unhealthy`);
  }
  if (problems.restarting) {
    parts.push(`${problems.restarting} restarting`);
  }
  if (problems.failed) {
    parts.push(`${problems.failed} failed`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

export function stackPresentation(stack: StackListItem, services?: readonly StackService[]): Presentation {
  switch (stack.info.state) {
    case 'running': {
      const problems = describeProblems(serviceProblems(services));
      return problems
        ? { icon: 'layers', tone: 'warn', label: `Running · ${problems}` }
        : { icon: 'layers', tone: 'ok', label: 'Running' };
    }
    case 'deploying':
      return { icon: 'sync~spin', tone: 'info', label: 'Deploying' };
    case 'restarting':
      return { icon: 'sync~spin', tone: 'warn', label: 'Restarting' };
    case 'removing':
      return { icon: 'sync~spin', tone: 'muted', label: 'Removing' };
    case 'paused':
      return { icon: 'layers', tone: 'info', label: 'Paused' };
    case 'created':
      return { icon: 'layers', tone: 'info', label: 'Created' };
    case 'stopped':
      return { icon: 'layers', tone: 'muted', label: 'Stopped' };
    case 'dead':
      return { icon: 'layers', tone: 'error', label: 'Dead' };
    case 'unhealthy': {
      const problems = describeProblems(serviceProblems(services));
      return { icon: 'layers', tone: 'warn', label: problems ? `Unhealthy · ${problems}` : 'Unhealthy (mixed states)' };
    }
    case 'down':
      return { icon: 'layers', tone: 'muted', label: 'Down (not deployed)' };
    default:
      return { icon: 'question', tone: 'muted', label: 'Unknown (server unreachable?)' };
  }
}

export function containerPresentation(container: Pick<ContainerListItem, 'state' | 'status'>): Presentation {
  const health = parseHealth(container.status);
  switch (container.state) {
    case 'running':
      if (health === 'unhealthy') {
        return { icon: 'warning', tone: 'warn', label: 'Running (unhealthy)' };
      }
      if (health === 'starting') {
        return { icon: 'circle-filled', tone: 'info', label: 'Running (health: starting)' };
      }
      return { icon: 'circle-filled', tone: 'ok', label: health === 'healthy' ? 'Running (healthy)' : 'Running' };
    case 'paused':
      return { icon: 'debug-pause', tone: 'info', label: 'Paused' };
    case 'restarting':
      return { icon: 'sync~spin', tone: 'warn', label: 'Restarting' };
    case 'created':
      return { icon: 'circle-outline', tone: 'info', label: 'Created' };
    case 'exited': {
      const code = parseExitCode(container.status);
      if (code !== undefined && code !== 0) {
        return { icon: 'error', tone: 'error', label: `Exited (${code})` };
      }
      return { icon: 'circle-outline', tone: 'muted', label: code === 0 ? 'Exited (0)' : 'Exited' };
    }
    case 'dead':
      return { icon: 'error', tone: 'error', label: 'Dead' };
    case 'stopping':
      return { icon: 'sync~spin', tone: 'muted', label: 'Stopping' };
    case 'removing':
      return { icon: 'sync~spin', tone: 'muted', label: 'Removing' };
    default:
      return { icon: 'circle-slash', tone: 'muted', label: 'Unknown' };
  }
}

export function servicePresentation(service: StackService | undefined): Presentation {
  if (service?.container) {
    return containerPresentation(service.container);
  }
  switch (service?.state) {
    case 'Healthy':
      return { icon: 'circle-filled', tone: 'ok', label: 'Healthy' };
    case 'Unhealthy':
      return { icon: 'warning', tone: 'warn', label: 'Unhealthy' };
    case 'Down':
      return { icon: 'circle-slash', tone: 'muted', label: 'Down' };
    default:
      return { icon: 'circle-slash', tone: 'muted', label: 'Not deployed' };
  }
}

/** Lowercase state token used in tree item `contextValue`s (drives which menu entries are shown). */
export function serviceStateToken(service: StackService | undefined): string {
  if (service?.container?.state) {
    return service.container.state;
  }
  return service?.state ? service.state.toLowerCase() : 'unknown';
}

export function containerStateToken(container: Pick<ContainerListItem, 'state'>): string {
  return container.state || 'unknown';
}

export function updatePresentation(update: { status: UpdateStatus; success: boolean }): Presentation {
  if (update.status === 'Queued') {
    return { icon: 'clock', tone: 'info', label: 'Queued' };
  }
  if (update.status === 'InProgress') {
    return { icon: 'sync~spin', tone: 'info', label: 'In progress' };
  }
  return update.success ? { icon: 'pass', tone: 'ok', label: 'Success' } : { icon: 'error', tone: 'error', label: 'Failed' };
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
