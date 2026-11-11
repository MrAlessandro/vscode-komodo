/**
 * End-to-end test of every extension action against a disposable local Komodo
 * (see docker-compose.yaml). Uses the extension's own code path:
 * catalog → buildParams → KomodoClient.execute → waitForUpdate.
 *
 *   npm run e2e:up && npm run test:e2e && npm run e2e:down
 *
 * Refuses to run against anything but localhost.
 */
import {
  ALL_ACTIONS,
  CONTAINER_ACTIONS,
  PRUNE_OPTIONS,
  SERVER_ACTIONS,
  SERVICE_ACTIONS,
  STACK_ACTIONS,
  buildParams,
  pruneAction,
  type ActionDef,
  type TargetRef,
} from '../../src/actions/catalog';
import { KomodoClient, formatError } from '../../src/api/client';
import { TerminalConnection, terminalWebsocketUrl } from '../../src/api/terminal';
import { waitForUpdate } from '../../src/api/poll';
import type { ContainerListItem, TerminalTarget, Update } from '../../src/api/types';
import { UpdatesSocket } from '../../src/api/updatesSocket';
import { composeFiles } from '../../src/documents/provider';
import { formatContainerLog, formatUpdate } from '../../src/model/format';
import { containerTerminalSpec, newSessionName, serverTerminalSpec, serviceTerminalSpec } from '../../src/terminal/specs';

const URL_ = process.env.KOMODO_E2E_URL ?? 'http://localhost:19120';
const USER = process.env.KOMODO_E2E_USER ?? 'e2e-admin';
const PASSWORD = process.env.KOMODO_E2E_PASSWORD ?? 'e2e-local-password';
const STACK = 'e2e-stack';
const COMPOSE = `services:
  web:
    image: nginx:alpine
  cache:
    image: redis:alpine
`;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(URL_)) {
  console.error(`Refusing to run destructive e2e tests against ${URL_}: only http://localhost is allowed.`);
  process.exit(2);
}

const results: { name: string; ok: boolean; detail?: string; ms: number }[] = [];
const executed = new Set<string>();

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const start = Date.now();
  try {
    const detail = (await fn()) ?? undefined;
    results.push({ name, ok: true, detail, ms: Date.now() - start });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: formatError(err), ms: Date.now() - start });
    console.log(`  ✘ ${name} — ${formatError(err)}`);
  }
}

async function waitFor<T>(label: string, get: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = await get();
      if (ok(last)) {
        return last;
      }
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timeout waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}

async function json<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(URL_ + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  console.log(`Komodo e2e against ${URL_}\n`);

  // ------------------------------------------------------------ setup --
  // GET / serves the web UI: no unauthenticated API calls (Komodo rate-limits failed auth).
  await waitFor('Komodo Core', () => fetch(`${URL_}/`).then((r) => r.ok), Boolean, 180_000);
  const login = await json<{ type: string; data: { jwt: string } }>('/auth/login/LoginLocalUser', { username: USER, password: PASSWORD });
  if (login.type !== 'Jwt' || !login.data?.jwt) {
    throw new Error(`unexpected login response: ${JSON.stringify(login).slice(0, 200)}`);
  }
  const jwt = login.data.jwt;
  const apiKey = await json<{ key: string; secret: string }>('/auth/manage/CreateApiKey', { name: `e2e-${Date.now()}`, expires: 0 }, { authorization: jwt });
  const client = new KomodoClient(URL_, apiKey);
  const write = <T>(type: string, params: unknown) =>
    json<T>(`/write/${type}`, params, { 'x-api-key': apiKey.key, 'x-api-secret': apiKey.secret });

  console.log(`Core v${await client.version()} — API key created for ${USER}`);
  const server = await waitFor(
    'server "Local" to be Ok',
    async () => (await client.read('ListServers', { limit: 0 })).find((s) => s.name === 'Local'),
    (s) => s?.info.state === 'Ok',
    180_000,
  );
  const serverId = server!.id;
  // "Ok" may be a cached state (e.g. right after a Periphery restart): wait for fresh stats.
  await waitFor(
    'live stats from Periphery',
    () => client.read('GetSystemStats', { server: serverId }),
    (stats) => !!stats.refresh_ts && Date.now() - stats.refresh_ts < 10_000,
    120_000,
  );
  console.log(`Server Local (${serverId}) is Ok and reachable\n`);

  // Live update stream, exactly as the extension subscribes to it.
  const streamed: string[] = [];
  let socketStatus = 'connecting';
  const socket = new UpdatesSocket({
    url: client.updatesWebsocketUrl,
    loginMessage: client.websocketLoginMessage(),
    onUpdate: (u) => streamed.push(`${u.operation}:${u.status}`),
    onStatus: (s) => (socketStatus = s),
  });
  socket.start();

  // Fresh stack.
  const existing = (await client.read('ListStacks', { limit: 0 })).find((s) => s.name === STACK);
  if (existing) {
    await write('DeleteStack', { id: existing.id });
  }
  const created = await write<{ _id: { $oid: string } }>('CreateStack', {
    name: STACK,
    config: { server_id: serverId, file_contents: COMPOSE },
  });
  const stackId = created._id.$oid;
  const stackRef: TargetRef = { kind: 'stack', stackId, stackName: STACK };
  const webRef: TargetRef = { kind: 'service', stackId, stackName: STACK, services: ['web'] };

  const containers = () => client.read('ListContainers', { server: serverId });
  const byName = (list: ContainerListItem[], name: string) => list.find((c) => c.name === name);
  const webName = `${STACK}-web-1`;
  const cacheName = `${STACK}-cache-1`;
  const states = async () => {
    const list = await containers();
    return { web: byName(list, webName)?.state ?? 'absent', cache: byName(list, cacheName)?.state ?? 'absent' };
  };
  const expectStates = (web: string, cache: string) =>
    waitFor(`web=${web} cache=${cache}`, states, (s) => s.web === web && s.cache === cache).then((s) => `web ${s.web}, cache ${s.cache}`);
  const stackState = (state: string) =>
    waitFor(`stack ${state}`, async () => (await client.read('ListStacks', { limit: 0 })).find((s) => s.id === stackId)?.info.state, (s) => s === state);

  async function run(def: ActionDef, target: TargetRef): Promise<Update> {
    executed.add(def.command === 'komodo.server.prune' ? `prune:${def.execute}` : def.command);
    const initial = await client.execute(def.execute, buildParams(def.execute, target) as never);
    const update = await waitForUpdate(client, initial, { intervalMs: 700 });
    if (!update.success) {
      throw new Error(`${def.execute} failed:\n${formatUpdate(update)}`);
    }
    return update;
  }
  const action = (list: readonly ActionDef[], execute: string) => list.find((a) => a.execute === execute)!;

  // ------------------------------------------------------------ stack --
  console.log('Stack actions');
  await check('Deploy stack', async () => {
    await run(action(STACK_ACTIONS, 'DeployStack'), stackRef);
    await stackState('running');
    return expectStates('running', 'running');
  });
  await check('Pull images (stack)', async () => {
    const u = await run(action(STACK_ACTIONS, 'PullStack'), stackRef);
    return `${u.logs.length} log stage(s)`;
  });
  await check('Restart stack', async () => {
    await run(action(STACK_ACTIONS, 'RestartStack'), stackRef);
    return expectStates('running', 'running');
  });
  await check('Stop stack', async () => {
    await run(action(STACK_ACTIONS, 'StopStack'), stackRef);
    await stackState('stopped');
    return expectStates('exited', 'exited');
  });
  await check('Start stack', async () => {
    await run(action(STACK_ACTIONS, 'StartStack'), stackRef);
    return expectStates('running', 'running');
  });
  await check('Pause stack', async () => {
    await run(action(STACK_ACTIONS, 'PauseStack'), stackRef);
    await stackState('paused');
    return expectStates('paused', 'paused');
  });
  await check('Unpause stack', async () => {
    await run(action(STACK_ACTIONS, 'UnpauseStack'), stackRef);
    return expectStates('running', 'running');
  });
  await check('Deploy stack if changed', async () => {
    const u = await run(action(STACK_ACTIONS, 'DeployStackIfChanged'), stackRef);
    await expectStates('running', 'running');
    return u.logs.map((l) => l.stage).join(', ') || 'no changes';
  });

  // ---------------------------------------------------------- service --
  console.log('\nService actions (web only)');
  await check('Stop service', async () => {
    await run(action(SERVICE_ACTIONS, 'StopStack'), webRef);
    return expectStates('exited', 'running');
  });
  await check('Start service', async () => {
    await run(action(SERVICE_ACTIONS, 'StartStack'), webRef);
    return expectStates('running', 'running');
  });
  await check('Restart service', async () => {
    await run(action(SERVICE_ACTIONS, 'RestartStack'), webRef);
    return expectStates('running', 'running');
  });
  await check('Pause service', async () => {
    await run(action(SERVICE_ACTIONS, 'PauseStack'), webRef);
    return expectStates('paused', 'running');
  });
  await check('Unpause service', async () => {
    await run(action(SERVICE_ACTIONS, 'UnpauseStack'), webRef);
    return expectStates('running', 'running');
  });
  await check('Pull service image', async () => {
    await run(action(SERVICE_ACTIONS, 'PullStack'), webRef);
  });
  await check('Destroy service', async () => {
    await run(action(SERVICE_ACTIONS, 'DestroyStack'), webRef);
    return expectStates('absent', 'running');
  });
  await check('Deploy service', async () => {
    await run(action(SERVICE_ACTIONS, 'DeployStack'), webRef);
    return expectStates('running', 'running');
  });

  // -------------------------------------------------------- container --
  console.log('\nContainer actions (cache container)');
  const cacheRef: TargetRef = { kind: 'container', serverId, serverName: 'Local', container: cacheName };
  await check('Stop container', async () => {
    await run(action(CONTAINER_ACTIONS, 'StopContainer'), cacheRef);
    return expectStates('running', 'exited');
  });
  await check('Start container', async () => {
    await run(action(CONTAINER_ACTIONS, 'StartContainer'), cacheRef);
    return expectStates('running', 'running');
  });
  await check('Restart container', async () => {
    await run(action(CONTAINER_ACTIONS, 'RestartContainer'), cacheRef);
    return expectStates('running', 'running');
  });
  await check('Pause container', async () => {
    await run(action(CONTAINER_ACTIONS, 'PauseContainer'), cacheRef);
    return expectStates('running', 'paused');
  });
  await check('Unpause container', async () => {
    await run(action(CONTAINER_ACTIONS, 'UnpauseContainer'), cacheRef);
    return expectStates('running', 'running');
  });
  await check('Destroy container', async () => {
    await run(action(CONTAINER_ACTIONS, 'DestroyContainer'), cacheRef);
    await expectStates('running', 'absent');
    await run(action(STACK_ACTIONS, 'DeployStack'), stackRef);
    return `${await expectStates('running', 'running')} after redeploy`;
  });

  // ----------------------------------------------------------- server --
  console.log('\nServer actions (isolated dind daemon)');
  const serverRef: TargetRef = { kind: 'server', serverId, serverName: 'Local' };
  await check('Stop all containers', async () => {
    await run(action(SERVER_ACTIONS, 'StopAllContainers'), serverRef);
    return expectStates('exited', 'exited');
  });
  await check('Start all containers', async () => {
    await run(action(SERVER_ACTIONS, 'StartAllContainers'), serverRef);
    return expectStates('running', 'running');
  });
  await check('Restart all containers', async () => {
    await run(action(SERVER_ACTIONS, 'RestartAllContainers'), serverRef);
    return expectStates('running', 'running');
  });
  await check('Pause all containers', async () => {
    await run(action(SERVER_ACTIONS, 'PauseAllContainers'), serverRef);
    return expectStates('paused', 'paused');
  });
  await check('Unpause all containers', async () => {
    await run(action(SERVER_ACTIONS, 'UnpauseAllContainers'), serverRef);
    return expectStates('running', 'running');
  });
  for (const option of PRUNE_OPTIONS) {
    await check(`Prune ${option.label.replace(/\s*⚠$/, '').toLowerCase()}`, async () => {
      await run(pruneAction(option), serverRef);
    });
  }

  // ------------------------------------------------- read-only views --
  console.log('\nData used by views, documents and the stats panel');
  await check('Stack services with container stats', async () => {
    const services = await client.read('ListAllStackServices', { limit: 0 });
    const mine = services.filter((s) => s.stack_id === stackId);
    if (mine.length !== 2) {
      throw new Error(`expected 2 services, got ${mine.length}`);
    }
    return mine.map((s) => `${s.service}: ${s.state}${s.container?.stats ? ` (cpu ${s.container.stats.cpu_perc})` : ''}`).join(', ');
  });
  await check('Service log (GetStackLog)', async () => {
    const log = await client.read('GetStackLog', { stack: stackId, services: ['cache'], tail: 20, timestamps: true });
    const text = formatContainerLog(log);
    if (!/redis|Ready to accept/i.test(text)) {
      throw new Error(`unexpected log: ${text.slice(0, 200)}`);
    }
    return `${text.split('\n').length} lines`;
  });
  await check('Container log (GetContainerLog)', async () => {
    const log = await client.read('GetContainerLog', { server: serverId, container: webName, tail: 20 });
    return `${formatContainerLog(log).split('\n').length} lines`;
  });
  await check('Inspect service / container', async () => {
    const a = (await client.read('InspectStackContainer', { stack: stackId, service: 'web' })) as { Name?: string };
    const b = (await client.read('InspectContainer', { server: serverId, container: cacheName })) as { Name?: string };
    return `${a.Name} / ${b.Name}`;
  });
  await check('Compose file (GetStack)', async () => {
    const files = composeFiles(await client.read('GetStack', { stack: stackId }));
    if (!files[0]?.contents.includes('nginx:alpine')) {
      throw new Error('compose contents not found');
    }
    return files.map((f) => f.path).join(', ');
  });
  await check('System stats & information', async () => {
    const stats = await client.read('GetSystemStats', { server: serverId });
    const info = await client.read('GetSystemInformation', { server: serverId });
    return `cpu ${stats.cpu_perc.toFixed(1)}%, mem ${stats.mem_used_gb.toFixed(1)}/${stats.mem_total_gb.toFixed(1)} GB, ${info.os ?? '?'}`;
  });
  await check('Historical stats', async () => {
    const history = await client.read('GetHistoricalServerStats', { server: serverId, granularity: '30-sec' });
    return `${history.stats.length} record(s)`;
  });
  await check('Updates list + log', async () => {
    const { updates } = await client.read('ListUpdates', {});
    const latest = await client.read('GetUpdate', { id: updates[0].id });
    return `${updates.length} updates, latest ${latest.operation} (${latest.logs.length} log stages)`;
  });
  await check('Update stream (websocket)', async () => {
    await waitFor('websocket updates', async () => streamed.length, (n) => n > 0, 10_000);
    return `${socketStatus}, ${streamed.length} updates received (e.g. ${streamed.slice(-2).join(', ')})`;
  });

  // -------------------------------------------------------- terminals --
  console.log('\nTerminals (same protocol code as the VS Code terminals)');
  /** CreateTerminal → websocket → resize + `echo $((6*7))` → `exit` → DeleteTerminal. */
  async function terminalRoundTrip(target: TerminalTarget, command: string | undefined): Promise<string> {
    const name = newSessionName();
    await client.write('CreateTerminal', {
      name,
      target,
      command,
      mode: target.type === 'Server' ? undefined : 'exec',
      recreate: 'Always',
    });
    let output = '';
    const result = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`timeout, output so far: ${JSON.stringify(output.slice(-300))}`));
      }, 30_000);
      let answered = false;
      let typed = false;
      const socket = new TerminalConnection({
        url: terminalWebsocketUrl(client.baseUrl, target, name),
        loginMessage: client.websocketLoginMessage(),
        onReady: () => socket.resize(40, 132),
        onData: (text) => {
          output += text;
          // Type like a person: once the shell has printed something (the prompt).
          if (!typed) {
            typed = true;
            socket.sendInput('echo KOMODO_E2E_$((6*7)) && stty size\r');
          }
          if (!answered && output.includes('KOMODO_E2E_42') && /40 132/.test(output)) {
            answered = true;
            socket.sendInput('exit\r');
          }
        },
        onNotice: (text) => (output += `[notice] ${text}`),
        onClose: (info) => {
          clearTimeout(timer);
          if (answered && info.loggedIn) {
            resolve('echo + resize OK, session ended on exit');
          } else {
            reject(new Error(`closed early (loggedIn=${info.loggedIn}, ${info.reason ?? 'no reason'}): ${JSON.stringify(output.slice(-300))}`));
          }
        },
      });
      socket.open();
    });
    await client.write('DeleteTerminal', { target, terminal: name }).catch(() => undefined);
    const left = await client.read('ListTerminals', { target, limit: 0 });
    if (left.some((t) => t.name === name)) {
      throw new Error(`session ${name} still listed after DeleteTerminal`);
    }
    return `${result}, session deleted`;
  }
  await check('Server terminal', () => terminalRoundTrip(serverTerminalSpec({ serverId, serverName: 'Local' }).target, undefined));
  await check('Container terminal (exec sh)', () =>
    terminalRoundTrip(containerTerminalSpec({ serverId, serverName: 'Local', container: cacheName }).target, 'sh'),
  );
  await check('Stack service terminal (exec sh)', () =>
    terminalRoundTrip(serviceTerminalSpec({ stackId, stackName: STACK }, 'web').target, 'sh'),
  );

  // ---------------------------------------------------------- cleanup --
  console.log('\nCleanup');
  await check('Destroy stack', async () => {
    await run(action(STACK_ACTIONS, 'DestroyStack'), stackRef);
    await stackState('down');
    return expectStates('absent', 'absent');
  });
  socket.dispose();
  await write('DeleteStack', { id: stackId });

  // ---------------------------------------------------------- summary --
  const expected = new Set([...ALL_ACTIONS.map((a) => a.command), ...PRUNE_OPTIONS.map((o) => `prune:${o.execute}`)]);
  const missing = [...expected].filter((c) => !executed.has(c));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; actions covered: ${executed.size}/${expected.size}`);
  if (missing.length) {
    console.log(`Not covered: ${missing.join(', ')}`);
  }
  if (failed.length || missing.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`E2E aborted: ${formatError(err)}`);
  process.exit(1);
});
