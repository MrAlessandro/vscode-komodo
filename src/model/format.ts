import type { Log, Update } from '../api/types';

export function percent(used: number | undefined, total: number | undefined): number | undefined {
  if (used === undefined || total === undefined || !Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return (used / total) * 100;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  if (value > 0 && value < 9.95) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

export function formatGb(gb: number | undefined): string {
  if (gb === undefined || !Number.isFinite(gb)) {
    return '–';
  }
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  if (gb >= 100) {
    return `${Math.round(gb)} GB`;
  }
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  return `${Math.round(gb * 1024)} MB`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return '–';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatRate(bytesPerSecond: number | undefined): string {
  return bytesPerSecond === undefined ? '–' : `${formatBytes(bytesPerSecond)}/s`;
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const seconds = Math.round((now - ts) / 1000);
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return '–';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Local `YYYY-MM-DD HH:mm:ss`. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `DeployStack` → `Deploy Stack` */
export function operationLabel(operation: string): string {
  return operation.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export type Health = 'healthy' | 'unhealthy' | 'starting';

/** Docker health from a status string like `Up 2 weeks (unhealthy)`. */
export function parseHealth(status: string | undefined): Health | undefined {
  const match = /\((healthy|unhealthy|health: starting)\)/.exec(status ?? '');
  if (!match) {
    return undefined;
  }
  return match[1] === 'health: starting' ? 'starting' : (match[1] as Health);
}

/** Exit code from a status string like `Exited (255) 4 months ago`. */
export function parseExitCode(status: string | undefined): number | undefined {
  const match = /^Exited \((-?\d+)\)/.exec(status ?? '');
  return match ? Number(match[1]) : undefined;
}

/** `1.016GiB / 3.747GiB` → `1.016GiB` */
export function memoryUsed(memUsage: string | undefined): string | undefined {
  const used = memUsage?.split('/')[0]?.trim();
  return used || undefined;
}

/** Strips the `Up ` prefix Docker puts in front of running containers' status. */
export function shortStatus(status: string | undefined): string | undefined {
  return status?.replace(/^Up /, 'up ');
}

function logBlock(log: Log): string {
  const icon = log.success ? '✔' : '✘';
  const duration = log.end_ts && log.start_ts ? ` (${formatDuration(log.end_ts - log.start_ts)})` : '';
  const lines = [`━━ ${log.stage} ${icon}${duration}`];
  if (log.command) {
    lines.push(`$ ${log.command}`);
  }
  const stdout = stripAnsi(log.stdout ?? '').trimEnd();
  const stderr = stripAnsi(log.stderr ?? '').trimEnd();
  if (stdout) {
    lines.push(stdout);
  }
  if (stderr) {
    // docker compose writes its progress to stderr, so stderr alone is not an error.
    lines.push(...(stdout ? ['--- stderr ---', stderr] : [stderr]));
  }
  return lines.join('\n');
}

/** Plain-text rendering of an update (execution) and its logs. */
export function formatUpdate(update: Update, targetName?: string): string {
  const title = `${operationLabel(update.operation)} · ${targetName ?? `${update.target.type} ${update.target.id}`}`;
  const status =
    update.status === 'Complete' ? (update.success ? '✔ Success' : '✘ Failed') : update.status === 'Queued' ? '… Queued' : '… In progress';
  const duration = update.end_ts ? ` · Duration ${formatDuration(update.end_ts - update.start_ts)}` : '';
  const header = [
    title,
    `${status} · Started ${formatTimestamp(update.start_ts)}${duration}`,
    update.commit_hash ? `Commit ${update.commit_hash}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  const body = update.logs.length ? update.logs.map(logBlock).join('\n\n') : '(no logs)';
  return `${header}\n\n${body}\n`;
}

/** Plain-text rendering of a container / stack log. */
export function formatContainerLog(log: Log): string {
  const stdout = stripAnsi(log.stdout ?? '');
  const stderr = stripAnsi(log.stderr ?? '');
  if (!log.success && stderr.trim()) {
    return `${stdout ? `${stdout.trimEnd()}\n` : ''}--- ${log.command || 'command'} failed ---\n${stderr}`;
  }
  return stderr.trim() ? `${stdout.trimEnd()}\n${stderr}` : stdout;
}
