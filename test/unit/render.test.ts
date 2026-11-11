import { describe, expect, it } from 'vitest';
import type { ThemeIcon } from 'vscode';
import type { Settings } from '../../src/config';
import type { KomodoStore } from '../../src/model/store';
import { buildSnapshot } from '../../src/model/snapshot';
import { serviceNodes } from '../../src/tree/nodes';
import { esc, formatPorts, renderNode, serverDescription } from '../../src/tree/render';
import { container, server, service, stack } from './fixtures';

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

/** A fake store backed by a real snapshot. */
function fakeStore(busy: Record<string, string> = {}): KomodoStore {
  const snapshot = buildSnapshot([server()], [stack()], [service()], []);
  return {
    stacksOnServer: (id: string) => snapshot.stacksByServer.get(id) ?? [],
    server: (id: string) => snapshot.serverById.get(id),
    servicesOf: (id: string) => snapshot.servicesByStack.get(id),
    busyLabel: (key: string) => busy[key],
    tagNames: () => [],
    targetName: () => 'shop',
  } as unknown as KomodoStore;
}

describe('server items', () => {
  it('shows stats and exposes state tokens for menus', () => {
    const item = renderNode({ kind: 'server', view: 'servers', server: server() }, fakeStore(), settings);
    expect(item.label).toBe('alpha-server');
    expect(item.description).toBe('CPU 12% · RAM 50% · Disk 40%');
    expect(item.contextValue).toBe('server state-ok has-stacks terminal');
    expect(item.id).toBe('servers/server/srv1');
    expect((item.iconPath as ThemeIcon).id).toBe('server-environment');
  });

  it('describes unreachable servers', () => {
    expect(serverDescription(server({ info: { state: 'NotOk' } }), settings)).toBe('unreachable');
    expect(serverDescription(server(), { serversShowStats: false })).toBe('');
  });
});

describe('stack items', () => {
  it('flags image updates and new commits', () => {
    const s = stack({
      info: {
        deployed_hash: 'abc1234',
        latest_hash: 'def5678',
        services: [{ service: 'backend', image: 'acme/backend', update_available: true }],
      },
    });
    const item = renderNode({ kind: 'stack', view: 'stacks', stack: s }, fakeStore(), settings);
    expect(item.contextValue).toBe('stack state-running update changed');
    expect(item.description).toBe('alpha-server · running(2) · ⬆ 1 image update · ⟳ new commit');
  });

  it('shows a spinner while an action runs', () => {
    const item = renderNode({ kind: 'stack', view: 'servers', stack: stack() }, fakeStore({ 'stack:stk1': 'Deploying' }), settings);
    expect((item.iconPath as ThemeIcon).id).toBe('loading~spin');
    expect(item.description).toBe('Deploying…');
  });
});

describe('service items', () => {
  it('shows docker status and container stats', () => {
    const [node] = serviceNodes('stacks', stack(), [service()]);
    const item = renderNode(node, fakeStore(), settings);
    expect(item.label).toBe('backend');
    expect(item.description).toBe('up 2 weeks (healthy) · CPU 0.25% · 1.016GiB');
    expect(item.contextValue).toBe('service state-running exec');
    const tooltip = (item.tooltip as { value: string }).value;
    expect(tooltip).toContain('`ghcr.io/acme/shop-backend:main`');
    expect(tooltip).toContain('222GB / 129GB');
  });

  it('marks services that are not deployed', () => {
    const nodes = serviceNodes('stacks', stack(), []);
    const item = renderNode(nodes[1], fakeStore(), settings);
    expect(item.contextValue).toBe('service state-unknown');
    expect(item.description).toBe('not deployed');
  });
});

describe('container items', () => {
  it('shows the owning stack service', () => {
    const item = renderNode(
      {
        kind: 'container',
        view: 'servers',
        server: server(),
        container: container({ state: 'exited', status: 'Exited (255) 4 months ago', stats: null }),
        owner: { stackId: 'stk1', stackName: 'shop', service: 'backend' },
      },
      fakeStore(),
      settings,
    );
    expect(item.contextValue).toBe('container state-exited');
    expect(item.description).toBe('Exited (255) 4 months ago · shop/backend');
    expect((item.iconPath as ThemeIcon).id).toBe('error');
  });
});

describe('helpers', () => {
  it('escapes markdown', () => {
    expect(esc('a_b*c|d')).toBe('a\\_b\\*c\\|d');
  });

  it('formats published ports', () => {
    expect(
      formatPorts([
        { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { IP: '::', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { PrivatePort: 53, Type: 'udp' },
      ]),
    ).toBe('8080→80, 53/udp');
  });
});
