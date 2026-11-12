import * as vscode from 'vscode';
import { formatError } from '../api/client';
import type {
  GetHistoricalServerStatsResponse,
  ServerAlertingThresholds,
  SystemInformation,
  SystemStatsRecord,
  Timelength,
} from '../api/types';
import type { ConnectionManager } from '../connection';
import type { KomodoDocumentProvider } from '../documents/provider';
import { getSettings } from '../config';
import type { KomodoStore } from '../model/store';
import type { TerminalManager } from '../terminal/komodoTerminal';
import { containerTerminalSpec, serverTerminalSpec } from '../terminal/specs';
import { statsHtml } from './statsHtml';

export type RangeKey = '1h' | '6h' | '24h' | '7d';

export const RANGES: Record<RangeKey, { granularity: Timelength; ms: number }> = {
  '1h': { granularity: '30-sec', ms: 3_600_000 },
  '6h': { granularity: '2-min', ms: 6 * 3_600_000 },
  '24h': { granularity: '10-min', ms: 24 * 3_600_000 },
  '7d': { granularity: '1-hr', ms: 7 * 86_400_000 },
};

const STATS_INTERVAL_MS = 15_000;
const HISTORY_INTERVAL_MS = 60_000;

interface ContainerRow {
  name: string;
  state: string;
  status?: string;
  image?: string;
  cpu: number | null;
  cpuText: string;
  memText: string;
  memPerc: number | null;
  net: string;
  block: string;
  pids: string;
  owner?: string;
}

export interface StatsPayload {
  server: {
    id: string;
    name: string;
    state: string;
    region?: string;
    version?: string;
    thresholds?: ServerAlertingThresholds;
    tags: string[];
    /** Server shell allowed by Periphery. */
    terminals: boolean;
    /** `docker exec` terminals allowed by Periphery. */
    containerTerminals: boolean;
  };
  info?: SystemInformation;
  stats?: unknown;
  containers?: ContainerRow[];
  history?: { range: RangeKey; points: { ts: number; cpu: number; mem: number; disk: number; rx: number; tx: number }[] };
  updatedAt: number;
  errors: string[];
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'range'; range: RangeKey }
  | { type: 'logs'; container: string }
  | { type: 'terminal'; container?: string }
  | { type: 'open' };

/** One webview panel per server, showing live system stats, history charts and container stats. */
export class StatsPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, StatsPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connection: ConnectionManager,
    private readonly store: KomodoStore,
    private readonly docs: KomodoDocumentProvider,
    private readonly terminals: TerminalManager,
  ) {}

  show(serverId: string): void {
    const existing = this.panels.get(serverId);
    if (existing) {
      existing.reveal();
      return;
    }
    const server = this.store.server(serverId);
    const panel = vscode.window.createWebviewPanel(
      'komodo.stats',
      `Stats: ${server?.name ?? serverId}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [] },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'komodo-light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'komodo-dark.svg'),
    };
    const instance = new StatsPanel(panel, serverId, this.connection, this.store, this.docs, this.terminals, () =>
      this.panels.delete(serverId),
    );
    this.panels.set(serverId, instance);
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

class StatsPanel {
  private range: RangeKey = '6h';
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private lastHistory = 0;
  private info: SystemInformation | undefined;
  private loading = false;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly serverId: string,
    private readonly connection: ConnectionManager,
    private readonly store: KomodoStore,
    private readonly docs: KomodoDocumentProvider,
    private readonly terminals: TerminalManager,
    private readonly onDispose: () => void,
  ) {
    const nonce = createNonce();
    panel.webview.html = statsHtml(panel.webview.cspSource, nonce);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.onMessage(msg)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) {
          void this.load(false);
        }
        this.syncTimer();
      }),
      panel.onDidDispose(() => this.dispose()),
    );
    this.syncTimer();
  }

  reveal(): void {
    this.panel.reveal();
    void this.load(false);
  }

  private onMessage(msg: InboundMessage): void {
    switch (msg.type) {
      case 'ready':
        void this.load(true);
        break;
      case 'refresh':
        void this.load(true);
        break;
      case 'range':
        if (msg.range in RANGES) {
          this.range = msg.range;
          void this.load(true);
        }
        break;
      case 'logs': {
        const server = this.store.server(this.serverId);
        if (server && typeof msg.container === 'string') {
          void this.docs.open({ kind: 'containerLog', serverId: server.id, serverName: server.name, container: msg.container });
        }
        break;
      }
      case 'terminal': {
        const server = this.store.server(this.serverId);
        if (!server) {
          break;
        }
        const ref = { serverId: server.id, serverName: server.name };
        const settings = getSettings();
        this.terminals.openTerminal(
          typeof msg.container === 'string' && msg.container
            ? containerTerminalSpec({ ...ref, container: msg.container }, settings.terminalContainerShell)
            : serverTerminalSpec(ref, settings.terminalServerShell),
        );
        break;
      }
      case 'open':
        void vscode.commands.executeCommand('komodo.openInBrowser', {
          kind: 'server',
          view: 'servers',
          server: this.store.server(this.serverId),
        });
        break;
    }
  }

  private syncTimer(): void {
    if (this.panel.visible && !this.statsTimer && !this.disposed) {
      this.statsTimer = setInterval(() => void this.load(false), STATS_INTERVAL_MS);
    } else if (!this.panel.visible && this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async load(forceHistory: boolean): Promise<void> {
    const client = this.connection.getClient();
    if (!client || this.loading || this.disposed) {
      return;
    }
    this.loading = true;
    const server = this.store.server(this.serverId);
    const id = this.serverId;
    const wantHistory = forceHistory || Date.now() - this.lastHistory > HISTORY_INTERVAL_MS;
    const range = this.range;
    try {
      const [stats, info, containers, history] = await Promise.allSettled([
        client.read('GetSystemStats', { server: id }),
        this.info ? Promise.resolve(this.info) : client.read('GetSystemInformation', { server: id }),
        client.read('ListContainers', { server: id }),
        wantHistory ? this.loadHistory(range) : Promise.resolve(undefined),
      ]);
      const errors: string[] = [];
      const value = <T>(r: PromiseSettledResult<T>, what: string): T | undefined => {
        if (r.status === 'fulfilled') {
          return r.value;
        }
        errors.push(`${what}: ${formatError(r.reason)}`);
        return undefined;
      };
      this.info = value(info, 'System information') ?? this.info;
      const payload: StatsPayload = {
        server: {
          id,
          name: server?.name ?? id,
          state: server?.info.state ?? 'Unknown',
          region: server?.info.region,
          version: server?.info.version,
          thresholds: server?.info.alerting_thresholds,
          tags: server ? this.store.tagNames(server.tags) : [],
          terminals: server?.info.state === 'Ok' && !server.info.terminals_disabled,
          containerTerminals: server?.info.state === 'Ok' && !server.info.container_terminals_disabled,
        },
        info: this.info,
        stats: value(stats, 'Stats'),
        containers: value(containers, 'Containers')?.map((c) => {
          const owner = this.store.containerOwner(id, c.name);
          return {
            name: c.name,
            state: c.state || 'unknown',
            status: c.status,
            image: c.image,
            cpu: parsePercent(c.stats?.cpu_perc),
            cpuText: c.stats?.cpu_perc ?? '–',
            memText: c.stats?.mem_usage ?? '–',
            memPerc: parsePercent(c.stats?.mem_perc),
            net: c.stats?.net_io ?? '–',
            block: c.stats?.block_io ?? '–',
            pids: c.stats?.pids ?? '–',
            owner: owner ? `${owner.stack.name}/${owner.service}` : undefined,
          };
        }),
        updatedAt: Date.now(),
        errors,
      };
      if (wantHistory) {
        const points = value(history, 'History');
        if (points) {
          payload.history = { range, points };
          this.lastHistory = Date.now();
        }
      }
      if (!this.disposed) {
        void this.panel.webview.postMessage({ type: 'data', payload });
        this.panel.title = `Stats: ${payload.server.name}`;
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadHistory(range: RangeKey) {
    const client = this.connection.getClient();
    if (!client) {
      return [];
    }
    const { granularity, ms } = RANGES[range];
    const since = Date.now() - ms;
    const records: SystemStatsRecord[] = [];
    let page: number | undefined = 0;
    // Pages are sorted newest first; stop once we are past the requested window.
    for (let i = 0; i < 5 && page !== undefined; i++) {
      const res: GetHistoricalServerStatsResponse = await client.read('GetHistoricalServerStats', {
        server: this.serverId,
        granularity,
        page,
      });
      records.push(...res.stats);
      const oldest: number = res.stats.at(-1)?.ts ?? 0;
      page = oldest > since && res.next_page !== undefined && res.next_page !== null ? res.next_page : undefined;
    }
    return records
      .filter((r) => r.ts >= since)
      .sort((a, b) => a.ts - b.ts)
      .map((r) => ({
        ts: r.ts,
        cpu: r.cpu_perc,
        mem: r.mem_total_gb ? (r.mem_used_gb / r.mem_total_gb) * 100 : 0,
        disk: r.disk_total_gb ? (r.disk_used_gb / r.disk_total_gb) * 100 : 0,
        rx: r.network_ingress_bytes ?? 0,
        tx: r.network_egress_bytes ?? 0,
      }));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.panel.dispose();
    this.onDispose();
  }
}

export function parsePercent(text: string | undefined): number | null {
  if (!text) {
    return null;
  }
  const value = Number.parseFloat(text.replace('%', ''));
  return Number.isFinite(value) ? value : null;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}
