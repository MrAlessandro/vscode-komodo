import * as vscode from 'vscode';
import { formatError, type KomodoClient } from '../api/client';
import type { FileContents, Stack } from '../api/types';
import { getSettings } from '../config';
import type { ConnectionManager } from '../connection';
import { formatContainerLog, formatUpdate } from '../model/format';
import type { KomodoStore } from '../model/store';

export const SCHEME = 'komodo';

export type DocRequest =
  | { kind: 'stackLog'; stackId: string; stackName: string; services: string[] }
  | { kind: 'containerLog'; serverId: string; serverName: string; container: string }
  | { kind: 'serviceInspect'; stackId: string; stackName: string; service: string }
  | { kind: 'containerInspect'; serverId: string; serverName: string; container: string }
  | { kind: 'compose'; stackId: string; stackName: string; file: string }
  | { kind: 'update'; id: string; title: string };

const LIVE_LOG_KINDS: ReadonlySet<DocRequest['kind']> = new Set(['stackLog', 'containerLog']);

function clean(segment: string): string {
  return segment.replace(/[\\/:*?"<>|#%]/g, '_');
}

/** The path is what VS Code shows as the tab title (and its extension picks the language). */
export function docPath(req: DocRequest): string {
  switch (req.kind) {
    case 'stackLog':
      return req.services.length === 1
        ? `/stacks/${clean(req.stackName)}/${clean(req.services[0])}.log`
        : `/stacks/${clean(req.stackName)}/${clean(req.stackName)}${req.services.length ? `-${req.services.length}-services` : ''}.log`;
    case 'containerLog':
      return `/servers/${clean(req.serverName)}/${clean(req.container)}.log`;
    case 'serviceInspect':
      return `/stacks/${clean(req.stackName)}/${clean(req.service)}.inspect.json`;
    case 'containerInspect':
      return `/servers/${clean(req.serverName)}/${clean(req.container)}.inspect.json`;
    case 'compose': {
      const name = req.file.split('/').pop() || 'compose.yaml';
      return `/stacks/${clean(req.stackName)}/${clean(name)}`;
    }
    case 'update':
      return `/updates/${clean(req.title)}.log`;
  }
}

export function docUri(req: DocRequest): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: docPath(req), query: JSON.stringify(req) });
}

export function parseDocRequest(uri: vscode.Uri): DocRequest | undefined {
  if (uri.scheme !== SCHEME) {
    return undefined;
  }
  try {
    const req = JSON.parse(uri.query) as DocRequest;
    return typeof req?.kind === 'string' ? req : undefined;
  } catch {
    return undefined;
  }
}

/** Compose files of a stack: deployed contents first, then remote (repo / host), then the UI-defined file. */
export function composeFiles(stack: Stack): FileContents[] {
  if (stack.info.deployed_contents?.length) {
    return stack.info.deployed_contents;
  }
  if (stack.info.remote_contents?.length) {
    return stack.info.remote_contents;
  }
  if (stack.config.file_contents?.trim()) {
    return [{ path: 'compose.yaml', contents: stack.config.file_contents }];
  }
  return [];
}

/**
 * Read-only virtual documents (`komodo:` scheme) for logs, `docker inspect` output,
 * compose files and update (execution) logs. Live logs can be "followed" (auto refresh).
 */
export class KomodoDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly followed = new Set<string>();
  private followTimer: ReturnType<typeof setInterval> | undefined;
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly store: KomodoStore,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.followed.delete(doc.uri.toString())) {
          this.syncFollowTimer();
          this.updateContext();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.followed.has(e.document.uri.toString())) {
          this.revealEnd(e.document.uri);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('komodo.logs.followInterval')) {
          this.restartFollowTimer();
        }
      }),
    );
    this.updateContext();
  }

  async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
    const req = parseDocRequest(uri);
    if (!req) {
      return 'Invalid Komodo document.\n';
    }
    const client = this.connection.getClient();
    if (!client) {
      return 'Komodo is not configured. Run "Komodo: Configure Connection…".\n';
    }
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
      return await this.render(client, req, controller.signal);
    } catch (err) {
      this.log.warn(`Loading ${uri.path} failed: ${formatError(err)}`);
      return `Failed to load from Komodo: ${formatError(err)}\n`;
    } finally {
      subscription.dispose();
    }
  }

  private async render(client: KomodoClient, req: DocRequest, signal: AbortSignal): Promise<string> {
    const settings = getSettings();
    switch (req.kind) {
      case 'stackLog': {
        const log = await client.read(
          'GetStackLog',
          { stack: req.stackId, services: req.services, tail: settings.logsTail, timestamps: settings.logsTimestamps },
          signal,
        );
        return formatContainerLog(log) || '(no log output)\n';
      }
      case 'containerLog': {
        const log = await client.read(
          'GetContainerLog',
          { server: req.serverId, container: req.container, tail: settings.logsTail, timestamps: settings.logsTimestamps },
          signal,
        );
        return formatContainerLog(log) || '(no log output)\n';
      }
      case 'serviceInspect':
        return `${JSON.stringify(await client.read('InspectStackContainer', { stack: req.stackId, service: req.service }, signal), null, 2)}\n`;
      case 'containerInspect':
        return `${JSON.stringify(await client.read('InspectContainer', { server: req.serverId, container: req.container }, signal), null, 2)}\n`;
      case 'compose': {
        const stack = await client.read('GetStack', { stack: req.stackId }, signal);
        const files = composeFiles(stack);
        const file = files.find((f) => f.path === req.file) ?? files[0];
        return file ? file.contents : `# No compose file available for stack ${req.stackName}.\n`;
      }
      case 'update': {
        const update = await client.read('GetUpdate', { id: req.id }, signal);
        return formatUpdate(update, this.store.targetName(update.target));
      }
    }
  }

  /** Opens (or refreshes, if already open) a Komodo document. */
  async open(req: DocRequest, options: { follow?: boolean } = {}): Promise<vscode.TextEditor> {
    const uri = docUri(req);
    const alreadyOpen = vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString());
    let doc = await vscode.workspace.openTextDocument(uri);
    if (doc.uri.path.endsWith('.log') && doc.languageId !== 'log') {
      doc = await vscode.languages.setTextDocumentLanguage(doc, 'log');
    }
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (alreadyOpen) {
      this.emitter.fire(uri);
    }
    if (LIVE_LOG_KINDS.has(req.kind) || req.kind === 'update') {
      this.revealEnd(uri);
    }
    if (options.follow && LIVE_LOG_KINDS.has(req.kind)) {
      this.follow(uri);
    }
    this.updateContext();
    return editor;
  }

  refresh(uri: vscode.Uri | undefined): void {
    if (uri?.scheme === SCHEME) {
      this.emitter.fire(uri);
    }
  }

  follow(uri: vscode.Uri | undefined): void {
    const req = uri && parseDocRequest(uri);
    if (!uri || !req || !LIVE_LOG_KINDS.has(req.kind)) {
      return;
    }
    this.followed.add(uri.toString());
    this.emitter.fire(uri);
    this.syncFollowTimer();
    this.updateContext();
  }

  unfollow(uri: vscode.Uri | undefined): void {
    if (uri && this.followed.delete(uri.toString())) {
      this.syncFollowTimer();
      this.updateContext();
    }
  }

  private syncFollowTimer(): void {
    if (this.followed.size && !this.followTimer) {
      this.followTimer = setInterval(() => this.tickFollow(), getSettings().logsFollowInterval * 1000);
    } else if (!this.followed.size && this.followTimer) {
      clearInterval(this.followTimer);
      this.followTimer = undefined;
    }
  }

  private restartFollowTimer(): void {
    if (this.followTimer) {
      clearInterval(this.followTimer);
      this.followTimer = undefined;
    }
    this.syncFollowTimer();
  }

  private tickFollow(): void {
    const visible = new Set(vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()));
    for (const key of this.followed) {
      if (visible.has(key)) {
        this.emitter.fire(vscode.Uri.parse(key));
      }
    }
  }

  private revealEnd(uri: vscode.Uri): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        const last = Math.max(0, editor.document.lineCount - 1);
        editor.revealRange(new vscode.Range(last, 0, last, 0), vscode.TextEditorRevealType.Default);
      }
    }
  }

  private updateContext(): void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const req = uri ? parseDocRequest(uri) : undefined;
    void vscode.commands.executeCommand('setContext', 'komodo.logIsLive', !!req && LIVE_LOG_KINDS.has(req.kind));
    void vscode.commands.executeCommand('setContext', 'komodo.logFollowing', !!uri && this.followed.has(uri.toString()));
  }

  dispose(): void {
    if (this.followTimer) {
      clearInterval(this.followTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
