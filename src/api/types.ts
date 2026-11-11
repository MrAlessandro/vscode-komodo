/**
 * The subset of the Komodo Core v2 HTTP API used by this extension.
 *
 * Hand-written against the public API reference of Komodo Core 2.3.x
 * (https://docs.rs/komodo_client). Only the fields the extension reads are
 * declared; Komodo may send more.
 */

export type I64 = number;

export interface MongoId {
  $oid: string;
}

export type ResourceTargetType =
  | 'System'
  | 'Swarm'
  | 'Server'
  | 'Stack'
  | 'Deployment'
  | 'Build'
  | 'Repo'
  | 'Procedure'
  | 'Action'
  | 'Builder'
  | 'Alerter'
  | 'ResourceSync';

export interface ResourceTarget {
  type: ResourceTargetType;
  id: string;
}

export interface ResourceListItem<Info> {
  id: string;
  type: ResourceTargetType;
  name: string;
  template: boolean;
  /** Tag ids */
  tags: string[];
  info: Info;
}

/** Komodo time lengths, e.g. `15-sec`, `1-min`, `1-hr`. */
export type Timelength =
  | '1-sec'
  | '5-sec'
  | '10-sec'
  | '15-sec'
  | '30-sec'
  | '1-min'
  | '2-min'
  | '5-min'
  | '10-min'
  | '15-min'
  | '30-min'
  | '1-hr'
  | '2-hr'
  | '6-hr'
  | '12-hr'
  | '1-day'
  | (string & {});

// ---------------------------------------------------------------- servers --

export type ServerState = 'Ok' | 'NotOk' | 'Disabled';

export interface SystemLoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

export interface MinimalSystemStats {
  cpu_perc: number;
  load_average?: SystemLoadAverage;
  mem_free_gb?: number;
  mem_used_gb: number;
  mem_total_gb: number;
  swap_total_gb?: number;
  swap_used_gb?: number;
  disk_total_gb: number;
  disk_used_gb: number;
  /** Bytes per second. */
  network_ingress_bytes?: number;
  /** Bytes per second. */
  network_egress_bytes?: number;
  polling_rate?: Timelength;
  /** Unix ms */
  refresh_ts?: I64;
}

export interface ServerAlertingThresholds {
  cpu_warning: number;
  cpu_critical: number;
  mem_warning: number;
  mem_critical: number;
  disk_warning: number;
  disk_critical: number;
}

export interface Serror {
  error: string;
  trace?: string[];
}

export interface ServerListItemInfo {
  state: ServerState;
  err?: Serror;
  stats?: MinimalSystemStats;
  alerting_thresholds?: ServerAlertingThresholds;
  core_count?: number;
  logical_core_count?: number;
  region?: string;
  address?: string;
  external_address?: string;
  public_ip?: string;
  /** Komodo Periphery version */
  version?: string;
  terminals_disabled?: boolean;
  container_terminals_disabled?: boolean;
}

export type ServerListItem = ResourceListItem<ServerListItemInfo>;

export interface SingleDiskUsage {
  mount: string;
  file_system?: string;
  used_gb: number;
  total_gb: number;
}

export interface SystemStats {
  cpu_perc: number;
  load_average?: SystemLoadAverage;
  mem_free_gb?: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_buff_cache_gb?: number;
  swap_total_gb?: number;
  swap_used_gb?: number;
  disks: SingleDiskUsage[];
  /** Bytes per second. */
  network_ingress_bytes?: number;
  /** Bytes per second. */
  network_egress_bytes?: number;
  polling_rate?: Timelength;
  refresh_ts?: I64;
}

export interface SystemInformation {
  name?: string;
  os?: string;
  kernel?: string;
  core_count?: number;
  logical_core_count?: number;
  host_name?: string;
  cpu_brand?: string;
  cpu_arch?: string;
}

export interface SystemStatsRecord {
  /** Unix ms */
  ts: I64;
  cpu_perc: number;
  load_average?: SystemLoadAverage;
  mem_used_gb: number;
  mem_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  network_ingress_bytes?: number;
  network_egress_bytes?: number;
}

export interface GetHistoricalServerStatsResponse {
  stats: SystemStatsRecord[];
  next_page?: number;
}

// ------------------------------------------------------------- containers --

export type ContainerState =
  | 'running'
  | 'created'
  | 'restarting'
  | 'stopping'
  | 'removing'
  | 'paused'
  | 'exited'
  | 'dead'
  | '';

export interface ContainerStats {
  name: string;
  /** e.g. `0.25%` */
  cpu_perc: string;
  /** e.g. `27.13%` */
  mem_perc: string;
  /** e.g. `1.016GiB / 3.747GiB` */
  mem_usage: string;
  /** e.g. `222GB / 129GB` */
  net_io: string;
  /** e.g. `32.7MB / 3.09MB` */
  block_io: string;
  pids: string;
}

export interface Port {
  IP?: string;
  PrivatePort?: number;
  PublicPort?: number | null;
  Type?: string;
}

export interface ContainerListItem {
  server_id?: string;
  server_name?: string;
  name: string;
  id?: string;
  image?: string;
  image_id?: string;
  /** Unix seconds */
  created?: I64;
  state: ContainerState;
  /** e.g. `Up 2 weeks (healthy)` / `Exited (0) 3 hours ago` */
  status?: string;
  network_mode?: string;
  networks?: string[];
  ports?: Port[];
  volumes?: string[];
  stats?: ContainerStats | null;
}

export interface ContainersSummary {
  total: number;
  running: number;
  stopped: number;
  unhealthy: number;
  unknown: number;
}

// ----------------------------------------------------------------- stacks --

export type StackState =
  | 'deploying'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'created'
  | 'restarting'
  | 'dead'
  | 'removing'
  | 'unhealthy'
  | 'down'
  | 'unknown';

export interface StackServiceWithUpdate {
  service: string;
  image: string;
  latest_image?: string;
  update_available: boolean;
}

export interface StackListItemInfo {
  swarm_id?: string;
  swarm_name?: string;
  server_id: string;
  server_name?: string;
  files_on_host?: boolean;
  file_contents?: boolean;
  linked_repo?: string;
  linked_repo_name?: string;
  git_provider?: string;
  repo?: string;
  branch?: string;
  repo_link?: string;
  state: StackState;
  /** e.g. `running(4)` or `exited(2), running(4)` */
  status?: string;
  services: StackServiceWithUpdate[];
  auto_update_all_services?: boolean;
  project_missing?: boolean;
  missing_files?: string[];
  deployed_hash?: string;
  latest_hash?: string;
}

export type StackListItem = ResourceListItem<StackListItemInfo>;

export type StackServiceState =
  | 'Healthy'
  | 'Unhealthy'
  | 'Down'
  | 'Running'
  | 'Created'
  | 'Paused'
  | 'Restarting'
  | 'Exited'
  | 'Stopping'
  | 'Removing'
  | 'Dead'
  | 'Unknown';

export interface StackService {
  stack_id: string;
  stack_name?: string;
  service: string;
  image: string;
  container?: ContainerListItem | null;
  state: StackServiceState;
  image_digests?: string[];
}

export interface FileContents {
  path: string;
  contents: string;
}

export interface Stack {
  _id?: MongoId;
  name: string;
  description?: string;
  tags: string[];
  config: {
    server_id?: string;
    file_contents?: string;
    file_paths?: string[];
    run_directory?: string;
    files_on_host?: boolean;
    repo?: string;
    branch?: string;
    linked_repo?: string;
  };
  info: {
    deployed_project_name?: string;
    deployed_hash?: string;
    deployed_message?: string;
    deployed_contents?: FileContents[];
    remote_contents?: FileContents[];
    remote_errors?: FileContents[];
    latest_hash?: string;
    latest_message?: string;
    missing_files?: string[];
  };
}

// ---------------------------------------------------------------- updates --

export type UpdateStatus = 'Queued' | 'InProgress' | 'Complete';

export interface Log {
  stage: string;
  command: string;
  stdout: string;
  stderr: string;
  success: boolean;
  start_ts: I64;
  end_ts: I64;
}

export interface Update {
  _id?: MongoId;
  operation: string;
  start_ts: I64;
  success: boolean;
  operator: string;
  target: ResourceTarget;
  logs: Log[];
  end_ts?: I64;
  status: UpdateStatus;
  commit_hash?: string;
}

export interface UpdateListItem {
  id: string;
  operation: string;
  start_ts: I64;
  success: boolean;
  username: string;
  operator: string;
  target: ResourceTarget;
  status: UpdateStatus;
}

export interface ListUpdatesResponse {
  updates: UpdateListItem[];
  next_page?: number;
}

// -------------------------------------------------------------- terminals --

/** What a Komodo terminal session runs on. Ids or names are accepted. */
export type TerminalTarget =
  | { type: 'Server'; params: { server: string } }
  | { type: 'Container'; params: { server: string; container: string } }
  | { type: 'Stack'; params: { stack: string; service: string } };

export type TerminalRecreateMode = 'Never' | 'Always' | 'DifferentCommand';

/** `exec` starts a new shell in the container; `attach` attaches to its main process. */
export type ContainerTerminalMode = 'exec' | 'attach';

/** A terminal session kept by Komodo Periphery (it survives websocket disconnections). */
export interface TerminalInfo {
  name: string;
  target: TerminalTarget;
  command: string;
  stored_size_kb: number;
  /** Unix ms */
  created_at: I64;
}

// ------------------------------------------------------------------- misc --

export interface Tag {
  _id?: MongoId;
  name: string;
  color?: string;
}

export interface User {
  _id?: MongoId;
  username: string;
  enabled: boolean;
  admin: boolean;
  super_admin?: boolean;
}

export interface CoreInfo {
  title: string;
  monitoring_interval: Timelength;
  webhook_base_url?: string;
  timezone?: string;
  ui_write_disabled?: boolean;
  disable_confirm_dialog?: boolean;
}

// ----------------------------------------------------------- request maps --

export interface ListParams {
  /** `0` returns every result (Komodo paginates by default). */
  limit?: number;
  page?: number;
}

/** `/read/<Type>`: [params, response] */
export interface ReadRequests {
  GetVersion: [Record<string, never>, { version: string }];
  GetCoreInfo: [Record<string, never>, CoreInfo];
  ListServers: [ListParams, ServerListItem[]];
  GetSystemStats: [{ server: string }, SystemStats];
  GetSystemInformation: [{ server: string }, SystemInformation];
  GetHistoricalServerStats: [
    { server: string; granularity: Timelength; page?: number },
    GetHistoricalServerStatsResponse,
  ];
  GetContainersSummary: [Record<string, never>, ContainersSummary];
  ListContainers: [{ server: string }, ContainerListItem[]];
  InspectContainer: [{ server: string; container: string }, unknown];
  GetContainerLog: [{ server: string; container: string; tail: number; timestamps?: boolean }, Log];
  ListStacks: [ListParams, StackListItem[]];
  GetStack: [{ stack: string }, Stack];
  ListStackServices: [{ stack: string }, StackService[]];
  ListAllStackServices: [ListParams & { stacks?: string[] }, StackService[]];
  GetStackLog: [{ stack: string; services: string[]; tail: number; timestamps?: boolean }, Log];
  InspectStackContainer: [{ stack: string; service: string }, unknown];
  ListTags: [Record<string, never>, Tag[]];
  GetUpdate: [{ id: string }, Update];
  ListUpdates: [{ page?: number; query?: Record<string, unknown> }, ListUpdatesResponse];
  ListTerminals: [{ target?: TerminalTarget; limit?: number }, TerminalInfo[]];
}

export type ReadType = keyof ReadRequests;
export type ReadParams<T extends ReadType> = ReadRequests[T][0];
export type ReadResponse<T extends ReadType> = ReadRequests[T][1];

/** `/write/<Type>`: [params, response]. Only terminal sessions are managed by the extension. */
export interface WriteRequests {
  CreateTerminal: [
    {
      /** Session name, unique per target. */
      name?: string;
      target: TerminalTarget;
      /** Shell command, e.g. `bash`. Default: Periphery config (servers) / `sh` (containers). */
      command?: string;
      mode?: ContainerTerminalMode;
      recreate?: TerminalRecreateMode;
    },
    TerminalInfo,
  ];
  DeleteTerminal: [{ target: TerminalTarget; terminal: string }, Record<string, never>];
}

export type WriteType = keyof WriteRequests;
export type WriteParams<T extends WriteType> = WriteRequests[T][0];
export type WriteResponse<T extends WriteType> = WriteRequests[T][1];

interface StackTarget {
  /** Stack id or name */
  stack: string;
  /** Restrict the action to these services. Empty / missing = whole stack. */
  services?: string[];
}

interface ContainerTarget {
  /** Server id or name */
  server: string;
  /** Container name */
  container: string;
}

interface ServerTarget {
  /** Server id or name */
  server: string;
}

/** `/execute/<Type>` params. Every execution returns an {@link Update}. */
export interface ExecuteRequests {
  DeployStack: StackTarget & { stop_time?: number };
  DeployStackIfChanged: { stack: string; stop_time?: number };
  PullStack: StackTarget;
  StartStack: StackTarget;
  RestartStack: StackTarget;
  StopStack: StackTarget & { stop_time?: number };
  PauseStack: StackTarget;
  UnpauseStack: StackTarget;
  DestroyStack: StackTarget & { remove_orphans?: boolean; stop_time?: number };

  StartContainer: ContainerTarget;
  RestartContainer: ContainerTarget;
  StopContainer: ContainerTarget & { time?: number };
  PauseContainer: ContainerTarget;
  UnpauseContainer: ContainerTarget;
  DestroyContainer: ContainerTarget & { time?: number };

  StartAllContainers: ServerTarget;
  RestartAllContainers: ServerTarget;
  StopAllContainers: ServerTarget;
  PauseAllContainers: ServerTarget;
  UnpauseAllContainers: ServerTarget;
  PruneContainers: ServerTarget;
  PruneImages: ServerTarget;
  PruneNetworks: ServerTarget;
  PruneVolumes: ServerTarget;
  PruneDockerBuilders: ServerTarget;
  PruneBuildx: ServerTarget;
  PruneSystem: ServerTarget;
}

export type ExecuteType = keyof ExecuteRequests;
