import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/model/snapshot';
import { serviceNodes } from '../../src/tree/nodes';
import { container, server, service, stack } from './fixtures';

describe('buildSnapshot', () => {
  const servers = [server({ id: 's2', name: 'zulu' }), server({ id: 'srv1', name: 'alpha-server' })];
  const stacks = [stack({ id: 'b', name: 'billing' }), stack({ id: 'stk1', name: 'shop' })];
  const services = [
    service({ service: 'redis', container: container({ name: 'shop-redis-1' }) }),
    service(),
    service({ stack_id: 'b', service: 'api', container: container({ name: 'billing-api-1' }) }),
  ];
  const snapshot = buildSnapshot(servers, stacks, services, [{ _id: { $oid: 't1' }, name: 'aws' }]);

  it('sorts and indexes servers and stacks', () => {
    expect(snapshot.servers.map((s) => s.name)).toEqual(['alpha-server', 'zulu']);
    expect(snapshot.stacks.map((s) => s.name)).toEqual(['billing', 'shop']);
    expect(snapshot.stacksByServer.get('srv1')?.map((s) => s.name)).toEqual(['billing', 'shop']);
    expect(snapshot.stacksByServer.get('s2')).toBeUndefined();
    expect(snapshot.tagsById.get('t1')?.name).toBe('aws');
  });

  it('groups services by stack, sorted by name', () => {
    expect(snapshot.servicesByStack.get('stk1')?.map((s) => s.service)).toEqual(['backend', 'redis']);
    expect(snapshot.servicesByStack.get('b')?.map((s) => s.service)).toEqual(['api']);
  });

  it('maps containers back to their stack service', () => {
    const owner = snapshot.containerOwners.get('srv1/shop-redis-1');
    expect(owner?.stack.name).toBe('shop');
    expect(owner?.service).toBe('redis');
    expect(snapshot.containerOwners.get('srv1/unknown')).toBeUndefined();
  });
});

describe('serviceNodes', () => {
  it('merges runtime info with the image update info of the stack', () => {
    const s = stack({
      info: {
        services: [
          { service: 'backend', image: 'acme/backend:1', update_available: true, latest_image: 'acme/backend:1@sha256:new' },
          { service: 'worker', image: 'acme/worker:1', update_available: false },
        ],
      },
    });
    const nodes = serviceNodes('stacks', s, [service()]);
    expect(nodes.map((n) => n.name)).toEqual(['backend', 'worker']);
    expect(nodes[0]).toMatchObject({ updateAvailable: true, latestImage: 'acme/backend:1@sha256:new' });
    expect(nodes[0].service?.container?.name).toBe('shop-backend-1');
    // Declared but without runtime info (e.g. not deployed yet).
    expect(nodes[1]).toMatchObject({ service: undefined, image: 'acme/worker:1', updateAvailable: false });
  });
});
