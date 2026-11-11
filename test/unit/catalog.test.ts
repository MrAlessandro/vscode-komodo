import { describe, expect, it } from 'vitest';
import {
  ALL_ACTIONS,
  CONTAINER_ACTIONS,
  PRUNE_OPTIONS,
  SERVER_ACTIONS,
  SERVICE_ACTIONS,
  STACK_ACTIONS,
  buildParams,
  busyKeys,
  describeTarget,
  needsConfirmation,
  pruneAction,
  type ServiceRef,
} from '../../src/actions/catalog';

const stackRef = { kind: 'stack', stackId: 'stk1', stackName: 'shop' } as const;
const serviceRef: ServiceRef = { kind: 'service', stackId: 'stk1', stackName: 'shop', services: ['backend', 'redis'] };
const containerRef = { kind: 'container', serverId: 'srv1', serverName: 'alpha', container: 'postgres' } as const;
const serverRef = { kind: 'server', serverId: 'srv1', serverName: 'alpha' } as const;

describe('action catalog', () => {
  it('has unique commands with the expected Komodo executions', () => {
    const commands = ALL_ACTIONS.map((a) => a.command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(STACK_ACTIONS.map((a) => a.execute)).toEqual([
      'DeployStack',
      'DeployStackIfChanged',
      'PullStack',
      'StartStack',
      'RestartStack',
      'StopStack',
      'PauseStack',
      'UnpauseStack',
      'DestroyStack',
    ]);
    expect(SERVICE_ACTIONS.every((a) => a.execute.endsWith('Stack'))).toBe(true);
    expect(CONTAINER_ACTIONS.every((a) => a.execute.endsWith('Container'))).toBe(true);
    expect(SERVER_ACTIONS.every((a) => a.execute.endsWith('AllContainers'))).toBe(true);
  });

  it('classifies destructive actions as dangerous', () => {
    const severity = (command: string) => ALL_ACTIONS.find((a) => a.command === command)?.severity;
    expect(severity('komodo.stack.destroy')).toBe('dangerous');
    expect(severity('komodo.service.destroy')).toBe('dangerous');
    expect(severity('komodo.server.stopAll')).toBe('dangerous');
    expect(severity('komodo.stack.restart')).toBe('disruptive');
    expect(severity('komodo.stack.pull')).toBe('safe');
    expect(severity('komodo.stack.start')).toBe('safe');
    expect(PRUNE_OPTIONS.map(pruneAction).every((a) => a.severity === 'dangerous')).toBe(true);
  });
});

describe('buildParams', () => {
  it('targets stacks by id', () => {
    expect(buildParams('RestartStack', stackRef)).toEqual({ stack: 'stk1' });
  });

  it('passes the selected services for service actions', () => {
    expect(buildParams('DeployStack', serviceRef)).toEqual({ stack: 'stk1', services: ['backend', 'redis'] });
    expect(buildParams('PullStack', serviceRef)).toEqual({ stack: 'stk1', services: ['backend', 'redis'] });
    // DeployStackIfChanged has no services filter.
    expect(buildParams('DeployStackIfChanged', serviceRef)).toEqual({ stack: 'stk1' });
  });

  it('targets containers and servers', () => {
    expect(buildParams('StopContainer', containerRef)).toEqual({ server: 'srv1', container: 'postgres' });
    expect(buildParams('PruneImages', serverRef)).toEqual({ server: 'srv1' });
  });
});

describe('confirmation policy', () => {
  it('follows komodo.confirmActions', () => {
    expect(needsConfirmation('safe', 'disruptive')).toBe(false);
    expect(needsConfirmation('disruptive', 'disruptive')).toBe(true);
    expect(needsConfirmation('dangerous', 'disruptive')).toBe(true);
    expect(needsConfirmation('disruptive', 'dangerous')).toBe(false);
    expect(needsConfirmation('dangerous', 'dangerous')).toBe(true);
    expect(needsConfirmation('safe', 'always')).toBe(true);
    expect(needsConfirmation('dangerous', 'never')).toBe(false);
  });
});

describe('targets', () => {
  it('describes targets for dialogs and notifications', () => {
    expect(describeTarget(stackRef)).toBe('stack “shop”');
    expect(describeTarget({ ...serviceRef, services: ['backend'] })).toBe('service “backend” of stack “shop”');
    expect(describeTarget(serviceRef)).toBe('services “backend”, “redis” of stack “shop”');
    expect(describeTarget(containerRef)).toBe('container “postgres” on “alpha”');
    expect(describeTarget(serverRef)).toBe('server “alpha”');
  });

  it('computes the busy keys used for tree spinners', () => {
    expect(busyKeys(stackRef)).toEqual(['stack:stk1']);
    expect(busyKeys(serviceRef)).toEqual(['service:stk1:backend', 'service:stk1:redis']);
    expect(busyKeys(containerRef)).toEqual(['container:srv1:postgres']);
    expect(busyKeys(serverRef)).toEqual(['server:srv1']);
  });
});
