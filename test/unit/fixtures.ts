import type {
  ContainerListItem,
  ServerListItem,
  StackListItem,
  StackService,
  Update,
} from '../../src/api/types';

/** Fixtures shaped like real Komodo Core 2.3 responses (names are fictional). */

export function server(overrides: Omit<Partial<ServerListItem>, 'info'> & { info?: Partial<ServerListItem['info']> } = {}): ServerListItem {
  const { info, ...rest } = overrides;
  return {
    id: 'srv1',
    type: 'Server',
    name: 'alpha-server',
    template: false,
    tags: [],
    ...rest,
    info: {
      state: 'Ok',
      region: 'eu',
      version: '2.3.3',
      logical_core_count: 2,
      alerting_thresholds: { cpu_warning: 90, cpu_critical: 99, mem_warning: 75, mem_critical: 95, disk_warning: 75, disk_critical: 95 },
      stats: {
        cpu_perc: 12.4,
        load_average: { one: 0.2, five: 0.3, fifteen: 0.25 },
        mem_used_gb: 2,
        mem_total_gb: 4,
        disk_used_gb: 8,
        disk_total_gb: 20,
        network_ingress_bytes: 1_390_165,
        network_egress_bytes: 1_693_229,
        refresh_ts: Date.now(),
      },
      ...info,
    },
  };
}

export function container(overrides: Partial<ContainerListItem> = {}): ContainerListItem {
  return {
    server_id: 'srv1',
    name: 'shop-backend-1',
    image: 'ghcr.io/acme/shop-backend:main',
    state: 'running',
    status: 'Up 2 weeks (healthy)',
    networks: ['shop_default'],
    ports: [{ IP: '', PrivatePort: 8000, PublicPort: null, Type: 'tcp' }],
    stats: {
      name: 'shop-backend-1',
      cpu_perc: '0.25%',
      mem_perc: '27.13%',
      mem_usage: '1.016GiB / 3.747GiB',
      net_io: '222GB / 129GB',
      block_io: '32.7MB / 3.09MB',
      pids: '16',
    },
    ...overrides,
  };
}

export function stack(overrides: Omit<Partial<StackListItem>, 'info'> & { info?: Partial<StackListItem['info']> } = {}): StackListItem {
  const { info, ...rest } = overrides;
  return {
    id: 'stk1',
    type: 'Stack',
    name: 'shop',
    template: false,
    tags: [],
    ...rest,
    info: {
      server_id: 'srv1',
      server_name: 'alpha-server',
      state: 'running',
      status: 'running(2)',
      services: [
        { service: 'backend', image: 'ghcr.io/acme/shop-backend:main', update_available: false },
        { service: 'redis', image: 'redis:8-alpine', update_available: false },
      ],
      ...info,
    },
  };
}

export function service(overrides: Partial<StackService> = {}): StackService {
  return {
    stack_id: 'stk1',
    stack_name: 'shop',
    service: 'backend',
    image: 'ghcr.io/acme/shop-backend:main',
    container: container(),
    state: 'Running',
    ...overrides,
  };
}

export function update(overrides: Partial<Update> = {}): Update {
  return {
    _id: { $oid: '6731f0c2a1b2c3d4e5f60718' },
    operation: 'RestartStack',
    start_ts: 1_700_000_000_000,
    end_ts: 1_700_000_004_500,
    success: true,
    operator: 'user1',
    target: { type: 'Stack', id: 'stk1' },
    status: 'Complete',
    logs: [
      {
        stage: 'Compose Restart',
        command: 'docker compose -p shop restart',
        stdout: '',
        stderr: ' Container shop-backend-1  Restarting\n Container shop-backend-1  Started\n',
        success: true,
        start_ts: 1_700_000_000_100,
        end_ts: 1_700_000_004_400,
      },
    ],
    ...overrides,
  };
}
