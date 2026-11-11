# Komodo for VS Code

Manage the servers, stacks and containers of a [Komodo](https://komo.do) Core instance (v2.x) from the VS Code sidebar.

## Features

**Sidebar (activity bar → Komodo)**

- **Servers** — every server with live CPU / RAM / disk usage, coloured against its Komodo alert thresholds. Expand a server to see its stacks (→ services) and a *Containers* folder with every Docker container on it.
- **Stacks** — all stacks with state, container status, image updates (`⬆`) and new commits not yet deployed (`⟳`). Expand a stack to see its services: Docker status, health, CPU and memory.
- **Activity** — the latest Komodo updates (deploys, restarts, procedures, auto-updates…), live. Click one to read its log.
- Status bar summary (`$(server) 38/38`), red when a server is unreachable.
- Real time: the views refresh as soon as anything happens in Komodo (update websocket), plus polling.

**Actions** (inline buttons, right-click menu, or Command Palette with a picker; multi-select supported)

| Target | Actions |
| --- | --- |
| Server | Show stats, Terminal, Pull images (all stacks), Start / Restart / Stop / Pause / Unpause **all containers**, Prune (images, containers, networks, volumes, build cache, system) |
| Stack | Deploy, Deploy if changed, Pull images, Start, Restart, Stop, Pause, Unpause, Destroy (`compose down`), Logs, Compose file |
| Service (container of a stack) | Deploy (only that service), Pull image, Start, Restart, Stop, Pause, Unpause, Destroy, Logs, Inspect, Terminal |
| Container | Start, Restart, Stop, Pause, Unpause, Destroy, Logs, Inspect, Terminal |

Every action shows a progress notification, waits for Komodo to finish, and offers the full execution log. Disruptive actions ask for confirmation first (see `komodo.confirmActions`); the dialog always names the Komodo host.

**Terminals** — open an interactive shell on a server, or `docker exec` into a stack service or container, right in the VS Code terminal panel (inline `$(terminal)` button or right-click → *Open Terminal*). *Open Terminal With Shell…* lets you pick `bash`, `sh`, `zsh`, `ash` or any command (e.g. `psql -U postgres`). Each VS Code terminal gets its own Komodo session, deleted as soon as the terminal is closed or the shell exits, so no orphan shells are left on your servers. When a session ends, press <kbd>Enter</kbd> for a new one. The entries are hidden where Komodo disables terminals (Periphery `disable_terminals` / `disable_container_terminals`) and for containers that are not running.

**Stats panel** — per server: CPU, memory, swap, disks, network, load average, history charts (1h / 6h / 24h / 7d) and a sortable table of container CPU / memory / network / block I/O (click a container to open its logs).

**Logs** open as read-only editors (Log syntax highlighting). Use the eye button in the editor title to *follow* a log.

## Setup

1. Create an API key in Komodo (**Settings → API Keys**). Copy the key and the secret.
2. Open the Komodo view and click **Configure Connection** (or run `Komodo: Configure Connection…`), enter the Core URL, key and secret.

The connection is verified before it is saved. URL, key and secret are stored together in **VS Code Secret Storage** (the macOS keychain / Windows Credential Manager / libsecret), never in `settings.json` — so a workspace setting can never redirect your credentials to another host.

If VS Code is started from a shell that exports `KOMODO_KEY` and `KOMODO_SECRET` (optionally `KOMODO_URL`), the view offers **Import from Environment**, which moves them into Secret Storage. `Komodo: Remove Stored Credentials` deletes them.

> Komodo rate-limits failed logins. When it rejects the credentials, the extension stops polling and the websocket until you refresh manually or reconfigure, so it never locks you out.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `komodo.refreshInterval` | `30` | Seconds between refreshes while a Komodo view is visible (every 5 min when hidden). `0` = no polling. |
| `komodo.realtimeUpdates` | `true` | Refresh on Komodo update events (websocket). |
| `komodo.confirmActions` | `disruptive` | `always`, `disruptive` (deploy/restart/stop/pause/destroy/prune/*all*), `dangerous` (destroy/prune/*all*), `never`. User-level only. |
| `komodo.notifications` | `all` | `errors` to only be notified of failures. |
| `komodo.servers.showStats` | `true` | CPU / RAM / disk next to servers. |
| `komodo.servers.showContainers` | `true` | *Containers* folder under each server. |
| `komodo.services.showStats` | `true` | CPU / memory next to services and containers. |
| `komodo.logs.tail` | `500` | Log lines to fetch (max 5000). |
| `komodo.logs.timestamps` | `true` | Docker timestamps in logs. |
| `komodo.logs.followInterval` | `5` | Seconds between refreshes of a followed log. |
| `komodo.statusBar.enabled` | `true` | Status bar summary. |
| `komodo.terminal.serverShell` | `""` | Command for server terminals (e.g. `bash`); empty = Periphery default. User-level only. |
| `komodo.terminal.containerShell` | `sh` | Command for `docker exec` terminals. User-level only. |

## How it talks to Komodo

A small typed client (`src/api`) calls the Komodo Core HTTP API with the `X-Api-Key` / `X-Api-Secret` headers:

- one refresh = `ListServers` (with stats) + `ListStacks` + `ListAllStackServices` (with container stats) + `ListTags`;
- actions = `POST /execute/<Type>` (e.g. `DeployStack { stack, services }`), then `GetUpdate` until the execution completes;
- live updates = `wss://<core>/ws/update`;
- terminals = `CreateTerminal` (unique session name) → `wss://<core>/ws/terminal?target[…]&terminal=<name>` (input frames end with `0x01`, resize frames are `{"rows","cols"}` + `0xFF`) → `DeleteTerminal` on close.

It has no runtime dependencies (the official `komodo_client` package is GPL-3.0 and is not used).

## Development

Requires Node 24 (`nvm use`).

```bash
npm install
npm run build        # bundle to dist/extension.js (esbuild)
npm run typecheck
npm test             # unit tests (vitest)
npm run package      # build the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

### End-to-end tests

`test/e2e` starts a disposable Komodo 2.3.3 (Core + Mongo + Periphery) whose Periphery manages an isolated Docker-in-Docker daemon, then runs **every** action of the extension against it with the extension's own code and checks the resulting container states, plus a round trip through server, container and stack-service terminals:

```bash
npm run e2e:up      # needs Docker and ~3 GB of free disk space
npm run test:e2e
npm run e2e:down
```

The script refuses to run against anything but `http://localhost`.

## Install

```bash
npm run package
code --install-extension vscode-komodo-0.2.1.vsix
```
