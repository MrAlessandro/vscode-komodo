import * as vscode from 'vscode';
import { formatError, type KomodoClient } from '../api/client';
import { updateId, waitForUpdate } from '../api/poll';
import type { ExecuteRequests, Update } from '../api/types';
import { getSettings } from '../config';
import type { ConnectionManager } from '../connection';
import type { KomodoDocumentProvider } from '../documents/provider';
import { formatUpdate } from '../model/format';
import type { KomodoStore } from '../model/store';
import {
  buildParams,
  busyKeys,
  describeTarget,
  needsConfirmation,
  type ActionDef,
  type TargetRef,
} from './catalog';

interface RunResult {
  target: TargetRef;
  ok: boolean;
  update?: Update;
  error?: unknown;
  cancelled?: boolean;
}

const MAX_PARALLEL = 4;

export interface RunOptions {
  /** Skip the confirmation dialog (the caller already confirmed). */
  confirmed?: boolean;
}

/** Runs Komodo executions with confirmation, progress, busy spinners, logging and notifications. */
export class ActionRunner {
  constructor(
    private readonly connection: ConnectionManager,
    private readonly store: KomodoStore,
    private readonly docs: KomodoDocumentProvider,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Asks for confirmation according to `komodo.confirmActions`. */
  async confirm(def: ActionDef, targets: readonly TargetRef[]): Promise<boolean> {
    if (!needsConfirmation(def.severity, getSettings().confirmActions)) {
      return true;
    }
    const host = this.connection.getClient()?.host ?? 'Komodo';
    const what = summarize(targets);
    const list =
      targets.length > 1
        ? `\n\n${targets
            .slice(0, 12)
            .map((t) => `• ${describeTarget(t)}`)
            .join('\n')}${targets.length > 12 ? `\n… and ${targets.length - 12} more` : ''}`
        : '';
    const label = def.confirmLabel ?? capitalize(def.verb);
    const choice = await vscode.window.showWarningMessage(
      `${capitalize(def.verb)} ${what}?`,
      { modal: true, detail: `${def.explain}${list}\n\nKomodo Core: ${host}` },
      label,
    );
    return choice === label;
  }

  async run(def: ActionDef, targets: readonly TargetRef[], options: RunOptions = {}): Promise<boolean> {
    if (!targets.length) {
      return false;
    }
    const client = this.connection.getClient();
    if (!client) {
      const choice = await vscode.window.showWarningMessage('Komodo is not configured yet.', 'Configure Connection…');
      if (choice) {
        await vscode.commands.executeCommand('komodo.configure');
      }
      return false;
    }
    if (!options.confirmed && !(await this.confirm(def, targets))) {
      return false;
    }
    const keys = targets.flatMap(busyKeys);
    this.store.setBusy(keys, def.ing);
    let results: RunResult[] = [];
    try {
      results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Komodo: ${def.ing} ${summarize(targets)}`,
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          const sub = token.onCancellationRequested(() => controller.abort());
          let done = 0;
          try {
            return await mapLimit(targets, MAX_PARALLEL, async (target) => {
              const result = await this.runOne(client, def, target, controller.signal);
              done++;
              if (targets.length > 1) {
                progress.report({ message: `${done}/${targets.length}`, increment: 100 / targets.length });
              }
              return result;
            });
          } finally {
            sub.dispose();
          }
        },
      );
    } finally {
      // Keep the spinner until fresh data is loaded, so the old state does not flash back.
      await this.store.refresh({ force: true }).catch(() => undefined);
      this.store.clearBusy(keys);
      void this.store.loadUpdates();
    }
    this.report(def, results);
    return results.every((r) => r.ok);
  }

  private async runOne(client: KomodoClient, def: ActionDef, target: TargetRef, signal: AbortSignal): Promise<RunResult> {
    const label = describeTarget(target);
    this.log.info(`▶ ${capitalize(def.verb)} ${label} [${def.execute}]`);
    try {
      const params = buildParams(def.execute, target) as ExecuteRequests[typeof def.execute];
      const initial = await client.execute(def.execute, params as never, signal);
      const update = await waitForUpdate(client, initial, { signal });
      this.log.info(formatUpdate(update, label));
      return { target, ok: update.success, update };
    } catch (err) {
      if (signal.aborted) {
        this.log.warn(`… stopped waiting for "${def.verb} ${label}". The operation keeps running in Komodo.`);
        return { target, ok: false, cancelled: true };
      }
      this.log.error(`✘ ${capitalize(def.verb)} ${label}: ${formatError(err)}`);
      return { target, ok: false, error: err };
    }
  }

  private report(def: ActionDef, results: RunResult[]): void {
    const failed = results.filter((r) => !r.ok && !r.cancelled);
    const cancelled = results.filter((r) => r.cancelled);
    if (failed.length) {
      const first = failed[0];
      const reason = first.error !== undefined ? formatError(first.error) : failureReason(first.update);
      const message =
        results.length === 1
          ? `Komodo: ${capitalize(def.verb)} ${describeTarget(first.target)} failed${reason ? `: ${reason}` : '.'}`
          : `Komodo: ${capitalize(def.verb)} failed for ${failed.length} of ${results.length}${reason ? ` (${describeTarget(first.target)}: ${reason})` : ''}`;
      void vscode.window.showErrorMessage(message, 'Show Log').then((choice) => {
        if (choice) {
          this.showLog(failed.length === 1 ? first.update : undefined);
        }
      });
      return;
    }
    if (cancelled.length) {
      void vscode.window.showInformationMessage(
        `Komodo: stopped waiting for "${def.verb} ${summarize(cancelled.map((r) => r.target))}". The operation keeps running in Komodo (see the Activity view).`,
      );
      return;
    }
    if (getSettings().notifications === 'all') {
      const message = `Komodo: ${def.past} ${summarize(results.map((r) => r.target))}.`;
      void vscode.window.showInformationMessage(message, 'Show Log').then((choice) => {
        if (choice) {
          this.showLog(results.length === 1 ? results[0].update : undefined);
        }
      });
    }
  }

  private showLog(update: Update | undefined): void {
    const id = update && updateId(update);
    if (update && id) {
      void this.docs.open({
        kind: 'update',
        id,
        title: `${update.operation}-${this.store.targetName(update.target)}-${id.slice(-6)}`,
      });
    } else {
      this.log.show(true);
    }
  }
}

function failureReason(update: Update | undefined): string | undefined {
  if (!update) {
    return undefined;
  }
  const failed = update.logs.find((l) => !l.success) ?? update.logs.at(-1);
  if (!failed) {
    return undefined;
  }
  const output = (failed.stderr || failed.stdout || '').trim().split('\n').filter(Boolean);
  const last = output.at(-1)?.trim();
  return last ? `${failed.stage} — ${last.slice(0, 240)}` : failed.stage;
}

function summarize(targets: readonly TargetRef[]): string {
  if (targets.length === 1) {
    return describeTarget(targets[0]);
  }
  const kinds = new Set(targets.map((t) => t.kind));
  if (kinds.size === 1) {
    const kind = targets[0].kind;
    if (kind === 'service') {
      const count = targets.reduce((n, t) => n + (t.kind === 'service' ? t.services.length : 0), 0);
      return `${count} services`;
    }
    return `${targets.length} ${kind}s`;
  }
  return `${targets.length} targets`;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
