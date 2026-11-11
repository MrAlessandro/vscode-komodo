import * as vscode from 'vscode';
import type { ContainerListItem, Port, ServerListItem } from '../api/types';
import type { Settings } from '../config';
import {
  formatGb,
  formatPercent,
  formatRate,
  formatTimestamp,
  memoryUsed,
  operationLabel,
  percent,
  relativeTime,
  shortStatus,
} from '../model/format';
import {
  containerPresentation,
  containerStateToken,
  serverHealth,
  serverPresentation,
  servicePresentation,
  serviceStateToken,
  stackPresentation,
  updatePresentation,
  type Presentation,
  type Tone,
} from '../model/status';
import type { KomodoStore } from '../model/store';
import {
  nodeId,
  type ContainerNode,
  type ContainersGroupNode,
  type KomodoNode,
  type MessageNode,
  type ServerNode,
  type ServiceNode,
  type StackNode,
  type UpdateNode,
} from './nodes';

const TONE_COLORS: Record<Tone, string> = {
  ok: 'charts.green',
  warn: 'charts.yellow',
  critical: 'charts.orange',
  error: 'charts.red',
  info: 'charts.blue',
  muted: 'disabledForeground',
};

export function toneColor(tone: Tone): vscode.ThemeColor {
  return new vscode.ThemeColor(TONE_COLORS[tone]);
}

export function themeIcon(presentation: Pick<Presentation, 'icon' | 'tone'>): vscode.ThemeIcon {
  return new vscode.ThemeIcon(presentation.icon, toneColor(presentation.tone));
}

const BUSY_ICON = new vscode.ThemeIcon('loading~spin');

export function renderNode(node: KomodoNode, store: KomodoStore, settings: Settings): vscode.TreeItem {
  let item: vscode.TreeItem;
  switch (node.kind) {
    case 'server':
      item = renderServer(node, store, settings);
      break;
    case 'stack':
      item = renderStack(node, store);
      break;
    case 'service':
      item = renderService(node, store, settings);
      break;
    case 'containers':
      item = renderContainersGroup(node);
      break;
    case 'container':
      item = renderContainer(node, store, settings);
      break;
    case 'update':
      item = renderUpdate(node, store);
      break;
    case 'message':
      item = renderMessage(node);
      break;
  }
  item.id = nodeId(node);
  return item;
}

// --------------------------------------------------------------- server --

function renderServer(node: ServerNode, store: KomodoStore, settings: Settings): vscode.TreeItem {
  const server = node.server;
  const stacks = store.stacksOnServer(server.id);
  const ok = server.info.state === 'Ok';
  const expandable = stacks.length > 0 || (ok && settings.serversShowContainers);
  const item = new vscode.TreeItem(
    server.name,
    expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  );
  const presentation = serverPresentation(server);
  const busy = store.busyLabel(`server:${server.id}`);
  item.iconPath = busy ? BUSY_ICON : themeIcon(presentation);
  item.description = busy ? `${busy}…` : serverDescription(server, settings);
  item.tooltip = serverTooltip(server, store, presentation);
  item.contextValue = [
    'server',
    `state-${server.info.state.toLowerCase()}`,
    stacks.length ? 'has-stacks' : '',
    ok && !server.info.terminals_disabled ? 'terminal' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return item;
}

export function serverDescription(server: ServerListItem, settings: Pick<Settings, 'serversShowStats'>): string {
  if (server.info.state === 'NotOk') {
    return 'unreachable';
  }
  if (server.info.state === 'Disabled') {
    return 'disabled';
  }
  const stats = server.info.stats;
  if (!settings.serversShowStats || !stats) {
    return '';
  }
  const mem = percent(stats.mem_used_gb, stats.mem_total_gb);
  const disk = percent(stats.disk_used_gb, stats.disk_total_gb);
  return `CPU ${formatPercent(stats.cpu_perc)} · RAM ${formatPercent(mem)} · Disk ${formatPercent(disk)}`;
}

function serverTooltip(server: ServerListItem, store: KomodoStore, presentation: Presentation): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  const info = server.info;
  md.appendMarkdown(`**${esc(server.name)}** — $(${presentation.icon}) ${esc(presentation.label)}\n\n`);
  if (info.err?.error) {
    md.appendMarkdown(`$(error) ${esc(info.err.error)}\n\n`);
  }
  const stats = info.stats;
  if (stats) {
    const health = serverHealth(info);
    const rows: [string, string][] = [
      [
        'CPU',
        `${formatPercent(stats.cpu_perc)}${stats.load_average ? ` · load ${stats.load_average.one.toFixed(2)} / ${stats.load_average.five.toFixed(2)} / ${stats.load_average.fifteen.toFixed(2)}` : ''}${info.logical_core_count ? ` · ${info.logical_core_count} vCPU` : ''}`,
      ],
      ['Memory', `${formatGb(stats.mem_used_gb)} / ${formatGb(stats.mem_total_gb)} (${formatPercent(health.mem)})`],
    ];
    if (stats.swap_total_gb) {
      rows.push(['Swap', `${formatGb(stats.swap_used_gb)} / ${formatGb(stats.swap_total_gb)}`]);
    }
    rows.push(['Disk', `${formatGb(stats.disk_used_gb)} / ${formatGb(stats.disk_total_gb)} (${formatPercent(health.disk)})`]);
    if (stats.network_ingress_bytes !== undefined || stats.network_egress_bytes !== undefined) {
      rows.push(['Network', `↓ ${formatRate(stats.network_ingress_bytes)} · ↑ ${formatRate(stats.network_egress_bytes)}`]);
    }
    md.appendMarkdown(table(rows));
    md.appendMarkdown('\n');
  }
  const meta: string[] = [];
  if (info.version) {
    meta.push(`Periphery v${esc(info.version)}`);
  }
  if (info.region) {
    meta.push(`Region ${esc(info.region)}`);
  }
  if (info.public_ip) {
    meta.push(`IP ${esc(info.public_ip)}`);
  }
  if (meta.length) {
    md.appendMarkdown(`${meta.join(' · ')}\n\n`);
  }
  const tags = store.tagNames(server.tags);
  if (tags.length) {
    md.appendMarkdown(`$(tag) ${tags.map(esc).join(', ')}\n\n`);
  }
  const stacks = store.stacksOnServer(server.id);
  if (stacks.length) {
    md.appendMarkdown(`$(layers) ${stacks.map((s) => esc(s.name)).join(', ')}\n\n`);
  }
  if (stats?.refresh_ts) {
    md.appendMarkdown(`_Stats from ${relativeTime(stats.refresh_ts)}_`);
  }
  return md;
}

// ---------------------------------------------------------------- stack --

function renderStack(node: StackNode, store: KomodoStore): vscode.TreeItem {
  const stack = node.stack;
  const services = store.servicesOf(stack.id);
  const hasServices = (services?.length ?? 0) > 0 || stack.info.services.length > 0;
  const item = new vscode.TreeItem(
    stack.name,
    hasServices ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  );
  const presentation = stackPresentation(stack, services);
  const busy = store.busyLabel(`stack:${stack.id}`);
  const updates = stack.info.services.filter((s) => s.update_available).length;
  const changed = !!(stack.info.latest_hash && stack.info.deployed_hash && stack.info.latest_hash !== stack.info.deployed_hash);
  item.iconPath = busy ? BUSY_ICON : themeIcon(presentation);
  const parts: string[] = [];
  if (busy) {
    parts.push(`${busy}…`);
  } else {
    if (node.view === 'stacks' && stack.info.server_name) {
      parts.push(stack.info.server_name);
    }
    parts.push(presentation.tone === 'ok' && stack.info.status ? stack.info.status : presentation.label.toLowerCase());
    if (updates) {
      parts.push(`⬆ ${updates} image update${updates > 1 ? 's' : ''}`);
    }
    if (changed) {
      parts.push('⟳ new commit');
    }
  }
  item.description = parts.join(' · ');
  item.tooltip = stackTooltip(node, store, presentation, updates, changed);
  item.contextValue = ['stack', `state-${stack.info.state}`, updates ? 'update' : '', changed ? 'changed' : '']
    .filter(Boolean)
    .join(' ');
  return item;
}

function stackTooltip(
  node: StackNode,
  store: KomodoStore,
  presentation: Presentation,
  updates: number,
  changed: boolean,
): vscode.MarkdownString {
  const stack = node.stack;
  const info = stack.info;
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${esc(stack.name)}** — $(${presentation.icon}) ${esc(presentation.label)}\n\n`);
  const rows: [string, string][] = [];
  if (info.server_name) {
    rows.push(['Server', esc(info.server_name)]);
  }
  if (info.status) {
    rows.push(['Containers', esc(info.status)]);
  }
  if (info.repo) {
    rows.push(['Repo', `${esc(info.repo)}${info.branch ? ` @ ${esc(info.branch)}` : ''}`]);
  } else if (info.linked_repo_name) {
    rows.push(['Repo', esc(info.linked_repo_name)]);
  } else if (info.files_on_host) {
    rows.push(['Source', 'files on host']);
  } else if (info.file_contents) {
    rows.push(['Source', 'compose defined in Komodo']);
  }
  if (info.deployed_hash) {
    rows.push(['Deployed', `${code(info.deployed_hash)}${changed ? ` → latest ${code(info.latest_hash ?? '')}` : ''}`]);
  }
  if (rows.length) {
    md.appendMarkdown(table(rows));
    md.appendMarkdown('\n');
  }
  if (updates) {
    md.appendMarkdown(`$(arrow-up) ${updates} service image update${updates > 1 ? 's' : ''} available — deploy or pull to apply.\n\n`);
  }
  if (info.project_missing && info.state !== 'down') {
    md.appendMarkdown('$(warning) Compose project not found on the host.\n\n');
  }
  if (info.missing_files?.length) {
    md.appendMarkdown(`$(warning) Missing files: ${info.missing_files.map(esc).join(', ')}\n\n`);
  }
  const tags = store.tagNames(stack.tags);
  if (tags.length) {
    md.appendMarkdown(`$(tag) ${tags.map(esc).join(', ')}`);
  }
  return md;
}

// -------------------------------------------------------------- service --

function renderService(node: ServiceNode, store: KomodoStore, settings: Settings): vscode.TreeItem {
  const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
  const container = node.service?.container ?? undefined;
  const presentation = servicePresentation(node.service);
  const busy = store.busyLabel(`service:${node.stack.id}:${node.name}`) ?? store.busyLabel(`stack:${node.stack.id}`);
  item.iconPath = busy ? BUSY_ICON : themeIcon(presentation);
  const parts: string[] = [];
  if (busy) {
    parts.push(`${busy}…`);
  } else if (container) {
    parts.push(shortStatus(container.status) ?? presentation.label.toLowerCase());
    if (settings.servicesShowStats && container.stats) {
      parts.push(...statsParts(container));
    }
  } else {
    parts.push(presentation.label.toLowerCase());
  }
  if (node.updateAvailable && !busy) {
    parts.push('⬆ update');
  }
  item.description = parts.join(' · ');
  item.tooltip = containerTooltip(
    node.name,
    container,
    presentation,
    node.image,
    `stack ${node.stack.name}`,
    node.updateAvailable ? (node.latestImage ?? 'newer image') : undefined,
  );
  const server = store.server(node.stack.info.server_id);
  const exec = container?.state === 'running' && !server?.info.container_terminals_disabled;
  item.contextValue = [
    'service',
    `state-${serviceStateToken(node.service)}`,
    node.updateAvailable ? 'update' : '',
    exec ? 'exec' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return item;
}

function statsParts(container: ContainerListItem): string[] {
  const stats = container.stats;
  if (!stats) {
    return [];
  }
  const parts = [`CPU ${stats.cpu_perc}`];
  const mem = memoryUsed(stats.mem_usage);
  if (mem) {
    parts.push(mem);
  }
  return parts;
}

function containerTooltip(
  title: string,
  container: ContainerListItem | undefined,
  presentation: Presentation,
  image: string | undefined,
  context: string,
  update: string | undefined,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${esc(title)}** — $(${presentation.icon}) ${esc(presentation.label)}\n\n`);
  const rows: [string, string][] = [['Belongs to', esc(context)]];
  const shownImage = container?.image ?? image;
  if (shownImage) {
    rows.push(['Image', code(shownImage)]);
  }
  if (container) {
    if (container.name !== title) {
      rows.push(['Container', code(container.name)]);
    }
    if (container.status) {
      rows.push(['Status', esc(container.status)]);
    }
    const ports = formatPorts(container.ports);
    if (ports) {
      rows.push(['Ports', esc(ports)]);
    }
    if (container.networks?.length) {
      rows.push(['Networks', esc(container.networks.join(', '))]);
    }
    const stats = container.stats;
    if (stats) {
      rows.push(['CPU', esc(stats.cpu_perc)]);
      rows.push(['Memory', `${esc(stats.mem_usage)} (${esc(stats.mem_perc)})`]);
      rows.push(['Net I/O', esc(stats.net_io)]);
      rows.push(['Block I/O', esc(stats.block_io)]);
      rows.push(['PIDs', esc(stats.pids)]);
    }
    if (container.created) {
      rows.push(['Created', formatTimestamp(container.created * 1000)]);
    }
  }
  md.appendMarkdown(table(rows));
  if (update) {
    md.appendMarkdown(`\n$(arrow-up) Image update available: ${code(update)}\n`);
  }
  return md;
}

export function formatPorts(ports: Port[] | undefined): string {
  if (!ports?.length) {
    return '';
  }
  const seen = new Set<string>();
  for (const port of ports) {
    if (!port.PrivatePort) {
      continue;
    }
    const proto = port.Type && port.Type !== 'tcp' ? `/${port.Type}` : '';
    seen.add(port.PublicPort ? `${port.PublicPort}→${port.PrivatePort}${proto}` : `${port.PrivatePort}${proto}`);
  }
  return [...seen].join(', ');
}

// ----------------------------------------------------------- containers --

function renderContainersGroup(node: ContainersGroupNode): vscode.TreeItem {
  const item = new vscode.TreeItem('Containers', vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = new vscode.ThemeIcon('package');
  item.tooltip = `All Docker containers on ${node.server.name}`;
  item.contextValue = 'containers';
  return item;
}

function renderContainer(node: ContainerNode, store: KomodoStore, settings: Settings): vscode.TreeItem {
  const container = node.container;
  const item = new vscode.TreeItem(container.name, vscode.TreeItemCollapsibleState.None);
  const presentation = containerPresentation(container);
  const busy =
    store.busyLabel(`container:${node.server.id}:${container.name}`) ??
    (node.owner ? store.busyLabel(`service:${node.owner.stackId}:${node.owner.service}`) : undefined);
  item.iconPath = busy ? BUSY_ICON : themeIcon(presentation);
  const parts: string[] = [];
  if (busy) {
    parts.push(`${busy}…`);
  } else {
    parts.push(shortStatus(container.status) ?? presentation.label.toLowerCase());
    if (settings.servicesShowStats && container.stats) {
      parts.push(...statsParts(container));
    }
  }
  if (node.owner) {
    parts.push(`${node.owner.stackName}/${node.owner.service}`);
  }
  item.description = parts.join(' · ');
  item.tooltip = containerTooltip(
    container.name,
    container,
    presentation,
    container.image,
    node.owner ? `stack ${node.owner.stackName} (service ${node.owner.service})` : `server ${node.server.name}`,
    undefined,
  );
  const exec = container.state === 'running' && !node.server.info.container_terminals_disabled;
  item.contextValue = `container state-${containerStateToken(container)}${exec ? ' exec' : ''}`;
  return item;
}

// --------------------------------------------------------------- update --

function renderUpdate(node: UpdateNode, store: KomodoStore): vscode.TreeItem {
  const update = node.update;
  const item = new vscode.TreeItem(operationLabel(update.operation), vscode.TreeItemCollapsibleState.None);
  const presentation = updatePresentation(update);
  item.iconPath = themeIcon(presentation);
  const target = store.targetName(update.target);
  const who = update.username || operatorLabel(update.operator);
  item.description = [target, relativeTime(update.start_ts), who].filter(Boolean).join(' · ');
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${esc(operationLabel(update.operation))}** — $(${presentation.icon}) ${esc(presentation.label)}\n\n`);
  md.appendMarkdown(
    table([
      ['Target', `${esc(update.target.type)} ${esc(target)}`],
      ['Started', formatTimestamp(update.start_ts)],
      ['By', esc(who || '–')],
    ]),
  );
  item.tooltip = md;
  item.contextValue = 'update';
  item.command = { command: 'komodo.update.open', title: 'Show Update Log', arguments: [node] };
  return item;
}

function operatorLabel(operator: string): string {
  // Komodo uses well-known ids for automated operations.
  if (/^0{20,}\d+$/.test(operator)) {
    return 'Komodo (automation)';
  }
  return operator;
}

// -------------------------------------------------------------- message --

function renderMessage(node: MessageNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  if (node.icon) {
    item.iconPath = node.tone ? themeIcon({ icon: node.icon, tone: node.tone }) : new vscode.ThemeIcon(node.icon);
  }
  item.description = node.description;
  item.tooltip = node.tooltip;
  item.command = node.command;
  item.contextValue = 'message';
  return item;
}

// -------------------------------------------------------------- helpers --

/** Escapes text for use inside a Markdown tooltip. */
export function esc(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (c) => `\\${c}`);
}

/** Inline code span (escapes are not interpreted inside backticks). */
function code(text: string): string {
  return `\`${text.replace(/[`|]/g, '')}\``;
}

function table(rows: [string, string][]): string {
  return `| | |\n|:--|:--|\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n`;
}
