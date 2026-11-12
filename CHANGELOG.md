# Changelog

## 0.2.2

- Stats panel: *Terminal* button for the server and for every running container (shown only where Komodo allows terminals), next to a *Logs* button.

## 0.2.1

- Terminals: `docker exec` sessions now get the right size from the start (the size is sent again once the process is up; they used to start as 24×80).
- End-to-end suite: verified against Komodo Core 2.3.3 (47/47 checks: every action, logs, stats, update stream and terminals).

## 0.2.0

- Terminals: interactive shell on servers and `docker exec` into stack services / containers, in the VS Code terminal panel.
- *Open Terminal With Shell…* (bash, sh, zsh, ash or any command); `komodo.terminal.serverShell` / `komodo.terminal.containerShell` settings (user-level only).
- Server-side terminal sessions are deleted when the terminal is closed or the shell exits.

## 0.1.0

- Servers, Stacks and Activity views for Komodo Core 2.x.
- Server, stack, service and container actions (deploy, pull, start, restart, stop, pause, unpause, destroy, prune, *all containers*).
- Logs (with follow), `docker inspect`, compose files and execution logs as read-only editors.
- Server stats panel with history charts and container stats.
- Credentials in VS Code Secret Storage, optional import from `KOMODO_KEY` / `KOMODO_SECRET`.
- Real-time refresh through the Komodo update websocket.
