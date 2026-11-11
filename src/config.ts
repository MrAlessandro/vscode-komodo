import * as vscode from 'vscode';
import type { ConfirmSetting } from './actions/catalog';

export interface Settings {
  refreshInterval: number;
  realtimeUpdates: boolean;
  confirmActions: ConfirmSetting;
  notifications: 'all' | 'errors';
  serversShowStats: boolean;
  serversShowContainers: boolean;
  servicesShowStats: boolean;
  logsTail: number;
  logsTimestamps: boolean;
  logsFollowInterval: number;
  statusBarEnabled: boolean;
  terminalServerShell: string;
  terminalContainerShell: string;
}

const CONFIRM_VALUES: readonly ConfirmSetting[] = ['always', 'disruptive', 'dangerous', 'never'];

export function getSettings(): Settings {
  const c = vscode.workspace.getConfiguration('komodo');
  const confirm = c.get<string>('confirmActions', 'disruptive');
  return {
    refreshInterval: clamp(c.get<number>('refreshInterval', 30), 0, 86_400),
    realtimeUpdates: c.get<boolean>('realtimeUpdates', true),
    confirmActions: (CONFIRM_VALUES as readonly string[]).includes(confirm) ? (confirm as ConfirmSetting) : 'disruptive',
    notifications: c.get<string>('notifications', 'all') === 'errors' ? 'errors' : 'all',
    serversShowStats: c.get<boolean>('servers.showStats', true),
    serversShowContainers: c.get<boolean>('servers.showContainers', true),
    servicesShowStats: c.get<boolean>('services.showStats', true),
    logsTail: Math.round(clamp(c.get<number>('logs.tail', 500), 10, 5000)),
    logsTimestamps: c.get<boolean>('logs.timestamps', true),
    logsFollowInterval: clamp(c.get<number>('logs.followInterval', 5), 2, 3600),
    statusBarEnabled: c.get<boolean>('statusBar.enabled', true),
    terminalServerShell: c.get<string>('terminal.serverShell', '').trim(),
    terminalContainerShell: c.get<string>('terminal.containerShell', 'sh').trim(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
