import { describe, expect, it } from 'vitest';
import {
  containerPresentation,
  serverHealth,
  serverPresentation,
  serviceProblems,
  servicePresentation,
  serviceStateToken,
  stackPresentation,
  updatePresentation,
} from '../../src/model/status';
import { container, server, service, stack } from './fixtures';

describe('servers', () => {
  it('is ok below the alerting thresholds', () => {
    expect(serverHealth(server().info).level).toBe('ok');
    expect(serverPresentation(server())).toMatchObject({ tone: 'ok', label: 'OK' });
  });

  it('uses the server alerting thresholds', () => {
    const hot = server({ info: { stats: { ...server().info.stats!, cpu_perc: 100, disk_used_gb: 16 } } });
    const health = serverHealth(hot.info);
    expect(health.level).toBe('critical');
    expect(health.reasons).toEqual(['CPU critical', 'disk high']);
    expect(serverPresentation(hot)).toMatchObject({ tone: 'critical', label: 'CPU critical, disk high' });
  });

  it('reports unreachable and disabled servers', () => {
    expect(serverPresentation(server({ info: { state: 'NotOk' } }))).toMatchObject({ tone: 'error', label: 'Unreachable' });
    expect(serverPresentation(server({ info: { state: 'Disabled' } }))).toMatchObject({ tone: 'muted' });
  });
});

describe('containers and services', () => {
  it('maps docker states and health', () => {
    expect(containerPresentation(container())).toMatchObject({ icon: 'circle-filled', tone: 'ok', label: 'Running (healthy)' });
    expect(containerPresentation(container({ status: 'Up 4 weeks (unhealthy)' }))).toMatchObject({ icon: 'warning', tone: 'warn' });
    expect(containerPresentation(container({ state: 'exited', status: 'Exited (255) 4 months ago' }))).toMatchObject({
      icon: 'error',
      label: 'Exited (255)',
    });
    expect(containerPresentation(container({ state: 'exited', status: 'Exited (0) 1 hour ago' }))).toMatchObject({ tone: 'muted' });
    expect(containerPresentation(container({ state: 'restarting' })).icon).toBe('sync~spin');
    expect(containerPresentation(container({ state: 'paused' })).label).toBe('Paused');
    expect(containerPresentation(container({ state: '' })).label).toBe('Unknown');
  });

  it('handles services without a container', () => {
    expect(servicePresentation(undefined).label).toBe('Not deployed');
    expect(servicePresentation(service({ container: null, state: 'Down' })).label).toBe('Down');
    expect(serviceStateToken(undefined)).toBe('unknown');
    expect(serviceStateToken(service({ container: null, state: 'Unknown' }))).toBe('unknown');
    expect(serviceStateToken(service())).toBe('running');
    expect(serviceStateToken(service({ container: container({ state: 'exited' }) }))).toBe('exited');
  });
});

describe('stacks', () => {
  it('is healthy when every container is fine', () => {
    expect(stackPresentation(stack(), [service()])).toMatchObject({ tone: 'ok', label: 'Running' });
  });

  it('flags running stacks with unhealthy or failed containers', () => {
    const services = [
      service(),
      service({ service: 'celery', container: container({ name: 'shop-celery-1', status: 'Up 4 weeks (unhealthy)' }) }),
      service({ service: 'migrate', container: container({ name: 'shop-migrate-1', state: 'exited', status: 'Exited (1) 2 days ago' }) }),
      service({ service: 'init', container: container({ name: 'shop-init-1', state: 'exited', status: 'Exited (0) 2 days ago' }) }),
    ];
    expect(serviceProblems(services)).toMatchObject({ unhealthy: 1, failed: 1, restarting: 0, total: 4 });
    expect(stackPresentation(stack(), services)).toMatchObject({ tone: 'warn', label: 'Running · 1 unhealthy, 1 failed' });
  });

  it('maps the other stack states', () => {
    expect(stackPresentation(stack({ info: { state: 'down' } })).tone).toBe('muted');
    expect(stackPresentation(stack({ info: { state: 'deploying' } })).icon).toBe('sync~spin');
    expect(stackPresentation(stack({ info: { state: 'dead' } })).tone).toBe('error');
    expect(stackPresentation(stack({ info: { state: 'unknown' } })).icon).toBe('question');
  });
});

describe('updates', () => {
  it('maps update status', () => {
    expect(updatePresentation({ status: 'InProgress', success: false }).icon).toBe('sync~spin');
    expect(updatePresentation({ status: 'Complete', success: true }).tone).toBe('ok');
    expect(updatePresentation({ status: 'Complete', success: false }).tone).toBe('error');
  });
});
