import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { __registeredCommands } from '../stubs/vscode';
import { ALL_ACTIONS } from '../../src/actions/catalog';
import { registerCommands, type CommandDeps } from '../../src/commands';
import type { Settings } from '../../src/config';
import type { KomodoStore } from '../../src/model/store';
import { buildSnapshot } from '../../src/model/snapshot';
import { serviceNodes, type KomodoNode } from '../../src/tree/nodes';
import { renderNode } from '../../src/tree/render';
import { container, server, service, stack } from './fixtures';

interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, MenuItem[]>;
    views: Record<string, { id: string }[]>;
    configuration: { properties: Record<string, unknown> };
  };
};
const declared = new Set(pkg.contributes.commands.map((c) => c.command));
const itemMenus = pkg.contributes.menus['view/item/context'];

type Context = Record<string, string | boolean | undefined>;

/** Tiny evaluator for the when-clause subset used in package.json (`&&`, `==`, `=~`, `!`). */
function evaluate(when: string | undefined, ctx: Context): boolean {
  if (!when) {
    return true;
  }
  return when.split('&&').every((raw) => {
    const term = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\S+)\s*=~\s*\/(.*)\/([a-z]*)$/.exec(term))) {
      const value = ctx[m[1]];
      return typeof value === 'string' && new RegExp(m[2], m[3]).test(value);
    }
    if ((m = /^(\S+)\s*==\s*(.+)$/.exec(term))) {
      return String(ctx[m[1]]) === m[2].trim();
    }
    if (term === 'false' || term === 'true') {
      return term === 'true';
    }
    if (term.startsWith('!')) {
      return !ctx[term.slice(1).trim()];
    }
    return !!ctx[term];
  });
}

function groupOrder(group = ''): [string, number] {
  const [name, order] = group.split('@');
  return [name, Number(order ?? 0)];
}

/** Commands shown for a tree item, in menu order. */
function menuFor(view: string, contextValue: string, inline: boolean): string[] {
  return itemMenus
    .filter((m) => (m.group ?? '').startsWith('inline') === inline && evaluate(m.when, { view, viewItem: contextValue }))
    .sort((a, b) => {
      const [ga, oa] = groupOrder(a.group);
      const [gb, ob] = groupOrder(b.group);
      return ga === gb ? oa - ob : ga.localeCompare(gb);
    })
    .map((m) => m.command.replace(/^komodo\./, ''));
}

const settings: Settings = {
  refreshInterval: 30,
  realtimeUpdates: true,
  confirmActions: 'disruptive',
  notifications: 'all',
  serversShowStats: true,
  serversShowContainers: true,
  servicesShowStats: true,
  logsTail: 500,
  logsTimestamps: true,
  logsFollowInterval: 5,
  statusBarEnabled: true,
  terminalServerShell: '',
  terminalContainerShell: 'sh',
};

const snapshot = buildSnapshot([server()], [stack()], [service()], []);
const store = {
  stacksOnServer: (id: string) => snapshot.stacksByServer.get(id) ?? [],
  server: (id: string) => snapshot.serverById.get(id),
  servicesOf: (id: string) => snapshot.servicesByStack.get(id),
  busyLabel: () => undefined,
  tagNames: () => [],
  targetName: () => 'shop',
} as unknown as KomodoStore;

/** The contextValue the real renderer produces for a node. */
function contextOf(node: KomodoNode): string {
  return renderNode(node, store, settings).contextValue ?? '';
}

describe('package.json manifest', () => {
  it('declares every command used in menus', () => {
    for (const [menu, items] of Object.entries(pkg.contributes.menus)) {
      for (const item of items) {
        expect(declared.has(item.command), `${menu} → ${item.command}`).toBe(true);
      }
    }
  });

  it('declares every action of the catalog', () => {
    for (const action of ALL_ACTIONS) {
      expect(declared.has(action.command), action.command).toBe(true);
    }
  });

  it('registers exactly the declared commands', () => {
    __registeredCommands.length = 0;
    registerCommands({ context: { subscriptions: [] } } as unknown as CommandDeps);
    expect(new Set(__registeredCommands)).toEqual(declared);
    expect(__registeredCommands.length).toBe(declared.size);
  });

  it('has valid when-clause regular expressions', () => {
    for (const items of Object.values(pkg.contributes.menus)) {
      for (const item of items) {
        for (const match of (item.when ?? '').matchAll(/=~\s*\/(.*?)\/([a-z]*)(?=\s*(&&|$))/g)) {
          expect(() => new RegExp(match[1], match[2]), item.when).not.toThrow();
        }
      }
    }
  });

  it('reads every contributed setting', () => {
    const configSource = readFileSync(new URL('../../src/config.ts', import.meta.url), 'utf8');
    for (const key of Object.keys(pkg.contributes.configuration.properties)) {
      expect(configSource.includes(`'${key.replace(/^komodo\./, '')}'`), key).toBe(true);
    }
  });

  it('keeps security-sensitive settings out of workspace control', () => {
    // A cloned repository's .vscode/settings.json must not decide what runs on your servers.
    for (const key of ['komodo.confirmActions', 'komodo.terminal.serverShell', 'komodo.terminal.containerShell']) {
      expect((pkg.contributes.configuration.properties[key] as { scope?: string }).scope, key).toBe('application');
    }
  });

  it('creates the tree views that are declared', () => {
    const extensionSource = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8');
    for (const view of pkg.contributes.views.komodo) {
      expect(extensionSource.includes(`createTreeView('${view.id}'`), view.id).toBe(true);
    }
  });
});

describe('tree item menus (contextValue ↔ when clauses)', () => {
  const view = 'komodo.servers';

  it('running stack', () => {
    const ctx = contextOf({ kind: 'stack', view: 'servers', stack: stack() });
    expect(menuFor(view, ctx, true)).toEqual(['stack.deploy', 'stack.stop', 'stack.restart', 'stack.logs']);
    const menu = menuFor(view, ctx, false);
    expect(menu).toEqual([
      'stack.deploy',
      'stack.deployIfChanged',
      'stack.pull',
      'stack.restart',
      'stack.stop',
      'stack.pause',
      'stack.destroy',
      'stack.logs',
      'stack.compose',
      'openInBrowser',
      'copyName',
    ]);
  });

  it('stopped and down stacks', () => {
    const stopped = contextOf({ kind: 'stack', view: 'stacks', stack: stack({ info: { state: 'stopped' } }) });
    expect(menuFor('komodo.stacks', stopped, true)).toEqual(['stack.deploy', 'stack.start', 'stack.restart', 'stack.logs']);
    const down = contextOf({ kind: 'stack', view: 'stacks', stack: stack({ info: { state: 'down' } }) });
    expect(menuFor('komodo.stacks', down, true)).toEqual(['stack.deploy']);
    const downMenu = menuFor('komodo.stacks', down, false);
    expect(downMenu).not.toContain('stack.stop');
    expect(downMenu).not.toContain('stack.destroy');
    expect(downMenu).not.toContain('stack.restart');
  });

  it('paused stack offers unpause', () => {
    const paused = contextOf({ kind: 'stack', view: 'stacks', stack: stack({ info: { state: 'paused' } }) });
    expect(menuFor('komodo.stacks', paused, false)).toContain('stack.unpause');
    expect(menuFor('komodo.stacks', paused, false)).not.toContain('stack.pause');
  });

  it('services by container state', () => {
    const [running] = serviceNodes('servers', stack(), [service()]);
    expect(menuFor(view, contextOf(running), true)).toEqual(['service.stop', 'service.restart', 'service.logs', 'service.terminal']);
    const [exited] = serviceNodes('servers', stack(), [service({ container: container({ state: 'exited', status: 'Exited (1) 1 hour ago' }) })]);
    expect(menuFor(view, contextOf(exited), true)).toEqual(['service.start', 'service.restart', 'service.logs']);
    const [paused] = serviceNodes('servers', stack(), [service({ container: container({ state: 'paused' }) })]);
    expect(menuFor(view, contextOf(paused), false)).toContain('service.unpause');

    const notDeployed = serviceNodes('servers', stack(), [])[0];
    expect(menuFor(view, contextOf(notDeployed), true)).toEqual([]);
    expect(menuFor(view, contextOf(notDeployed), false)).toEqual(['service.deploy', 'service.pull', 'openInBrowser', 'copyName']);
  });

  it('servers', () => {
    const ok = contextOf({ kind: 'server', view: 'servers', server: server() });
    expect(menuFor(view, ok, true)).toEqual(['server.showStats', 'server.terminal']);
    expect(menuFor(view, ok, false)).toEqual([
      'server.showStats',
      'server.terminal',
      'terminal.openWithShell',
      'server.pullStacks',
      'server.startAll',
      'server.restartAll',
      'server.stopAll',
      'server.pauseAll',
      'server.unpauseAll',
      'server.prune',
      'openInBrowser',
      'copyName',
    ]);
    const unreachable = contextOf({ kind: 'server', view: 'servers', server: server({ info: { state: 'NotOk' } }) });
    expect(menuFor(view, unreachable, false)).toEqual(['openInBrowser', 'copyName']);
    const withoutStacks = contextOf({ kind: 'server', view: 'servers', server: server({ id: 'other' }) });
    expect(menuFor(view, withoutStacks, false)).not.toContain('server.pullStacks');
  });

  it('containers', () => {
    const running = contextOf({ kind: 'container', view: 'servers', server: server(), container: container() });
    expect(menuFor(view, running, true)).toEqual(['container.stop', 'container.restart', 'container.logs', 'container.terminal']);
    const exited = contextOf({
      kind: 'container',
      view: 'servers',
      server: server(),
      container: container({ state: 'exited', status: 'Exited (0) 1 hour ago' }),
    });
    expect(menuFor(view, exited, true)).toEqual(['container.start', 'container.restart', 'container.logs']);
  });

  it('offers terminals only where Komodo allows them', () => {
    const [running] = serviceNodes('servers', stack(), [service()]);
    expect(menuFor(view, contextOf(running), false)).toEqual(expect.arrayContaining(['service.terminal', 'terminal.openWithShell']));
    const [stopped] = serviceNodes('servers', stack(), [service({ container: container({ state: 'exited', status: 'Exited (0) 1 hour ago' }) })]);
    expect(menuFor(view, contextOf(stopped), false)).not.toContain('service.terminal');

    const noServerTerminals = contextOf({ kind: 'server', view: 'servers', server: server({ info: { terminals_disabled: true } }) });
    expect(menuFor(view, noServerTerminals, false)).not.toContain('server.terminal');
    expect(menuFor(view, noServerTerminals, false)).not.toContain('terminal.openWithShell');

    const noExec = contextOf({
      kind: 'container',
      view: 'servers',
      server: server({ info: { container_terminals_disabled: true } }),
      container: container(),
    });
    expect(menuFor(view, noExec, true)).toEqual(['container.stop', 'container.restart', 'container.logs']);
  });

  it('does not leak menus to other extensions views', () => {
    const ctx = contextOf({ kind: 'stack', view: 'servers', stack: stack() });
    expect(menuFor('docker.containers', ctx, false)).toEqual([]);
  });
});
