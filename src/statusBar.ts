import * as vscode from 'vscode';
import { formatError } from './api/client';
import { getSettings } from './config';
import type { ConnectionManager } from './connection';
import { relativeTime } from './model/format';
import { serverHealth, stackPresentation } from './model/status';
import type { KomodoStore } from './model/store';

/** `$(server-environment) 37/38` health summary; red background only when something is unreachable. */
export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('komodo.status', vscode.StatusBarAlignment.Left, 20);
  private readonly disposables: vscode.Disposable[] = [this.item];

  constructor(
    private readonly store: KomodoStore,
    private readonly connection: ConnectionManager,
  ) {
    this.item.name = 'Komodo';
    this.item.command = 'workbench.view.extension.komodo';
    this.disposables.push(
      store.onDidChange(() => this.update()),
      connection.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('komodo.statusBar')) {
          this.update();
        }
      }),
    );
    this.update();
  }

  update(): void {
    if (!getSettings().statusBarEnabled || !this.connection.isConfigured) {
      this.item.hide();
      return;
    }
    const host = this.connection.getClient()?.host ?? '';
    const snapshot = this.store.snapshot;
    const error = this.store.error;
    if (!snapshot) {
      this.item.text = error !== undefined ? '$(server-environment) Komodo $(error)' : '$(sync~spin) Komodo';
      this.item.tooltip = error !== undefined ? `Komodo (${host}): ${formatError(error)}` : `Komodo: loading ${host}…`;
      this.item.backgroundColor = error !== undefined ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
      this.item.show();
      return;
    }
    const enabled = snapshot.servers.filter((s) => s.info.state !== 'Disabled');
    const down = enabled.filter((s) => s.info.state === 'NotOk');
    const stressed = enabled.filter((s) => s.info.state === 'Ok' && serverHealth(s.info).level !== 'ok');
    const troubled = snapshot.stacks.filter((stack) => {
      const tone = stackPresentation(stack, snapshot.servicesByStack.get(stack.id)).tone;
      return tone === 'warn' || tone === 'error' || tone === 'critical';
    });
    let text = `$(server-environment) ${enabled.length - down.length}/${enabled.length}`;
    if (troubled.length) {
      text += ` $(layers) ${troubled.length}`;
    }
    if (stressed.length) {
      text += ` $(pulse) ${stressed.length}`;
    }
    if (error !== undefined) {
      text += ' $(warning)';
    }
    this.item.text = text;
    this.item.backgroundColor =
      down.length || error !== undefined ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Komodo** — ${host}${this.store.coreVersion ? ` (v${this.store.coreVersion})` : ''}\n\n`);
    md.appendMarkdown(`$(server-environment) ${enabled.length - down.length} of ${enabled.length} servers reachable\n\n`);
    if (down.length) {
      md.appendMarkdown(`$(error) Unreachable: ${down.map((s) => s.name).join(', ')}\n\n`);
    }
    if (stressed.length) {
      md.appendMarkdown(
        `$(pulse) High usage: ${stressed.map((s) => `${s.name} (${serverHealth(s.info).reasons.join(', ')})`).join(', ')}\n\n`,
      );
    }
    md.appendMarkdown(`$(layers) ${snapshot.stacks.length} stacks`);
    md.appendMarkdown(troubled.length ? `, needing attention: ${troubled.map((s) => s.name).join(', ')}\n\n` : ', all healthy\n\n');
    if (error !== undefined) {
      md.appendMarkdown(`$(warning) Last refresh failed: ${formatError(error)}\n\n`);
    }
    md.appendMarkdown(`_Updated ${relativeTime(snapshot.fetchedAt)} · click to open the Komodo view_`);
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
