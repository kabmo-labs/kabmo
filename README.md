<p align="center">
  <img src="public/icon-512x512.png" alt="OMPChamber" width="140" height="140">
</p>

<h1 align="center">OMPChamber</h1>

<p align="center">
  Browser console and diagnostic chamber for <a href="https://github.com/can1357/oh-my-pi">Oh-My-Pi</a> (<code>omp</code>) agent sessions.<br>
  Watch, steer and audit autonomous coding sessions from one paper-flat dashboard.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ompchamber"><img alt="npm version" src="https://img.shields.io/npm/v/ompchamber?logo=npm&logoColor=white&color=cb3837"></a>
  <a href="https://bun.sh"><img alt="Bun &ge; 1.4" src="https://img.shields.io/badge/Bun-%E2%89%A51.4-000000?logo=bun&logoColor=white"></a>
  <a href="https://elysiajs.com"><img alt="Elysia" src="https://img.shields.io/github/package-json/dependency-version/rajebdev/ompchamber/elysia?color=6f42c1&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBmaWxsPSIjZmZmIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00MjQgNDcxQTI1NSAyNTUgMCAwIDAgMjU2IDIyIDI1NiAyNTYgMCAwIDAgODMgNDY3di0ybDMzNi0xMTB6TTIwMyAyMTkgNzIgNDUzaC0zbC0yLTItMTEtMTMtOC05LTE3LTI3LTEtMnEtOC0xNS0xNC0zMmwtMy0xMHEtOS0zMC00LTU5di0xcTItMTMgNi0yNWw2LTE3IDQtMTBxMTAtMjEgMjgtMzdsNS02cTE3LTE1IDQxLTIybC0xMSAyLTcgMWgtNmwtNiAxLTYgMWgtN2wtMS0xaDFsNC0ycTIwLTExIDMwLTI5bDQtN3E5LTEzIDIxLTIxbDItMSAxMC01IDE1LTVxNS0yIDctNnYtMWE5IDkgMCAwIDAtMi0xMGwtMy0ydi0xbC0xOC0yMy0xNC0yMHEtNS02LTUtMTMgMC0yIDItMWwxNSA3cTIwIDEwIDQzIDRsMTAtMiA3LTFxMjYtMyA1MyA1aDFsMTcgNnEzMyAxMyA0NiA0NWwzIDE0YTU2IDU2IDAgMCAwIDIyIDMybDkgNiAxMiA3IDIwIDEwIDEgM3EtOSAxMC0yMSAxNmwtMTIgNS0xNCA1LTggMnEtMTggNS0zNiA1aC0yMWwtMTItMmMtMTUtNi0zMyAwLTQxIDE0Ii8%2BPC9zdmc%2B"></a>
  <a href="https://preactjs.com"><img alt="Preact" src="https://img.shields.io/github/package-json/dependency-version/rajebdev/ompchamber/preact?logo=preact&logoColor=white&color=673ab7"></a>
  <a href="https://shiki.style"><img alt="Shiki" src="https://img.shields.io/github/package-json/dependency-version/rajebdev/ompchamber/shiki?color=3f3f46&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNjYgMjY2Ij48Y2lyY2xlIGN4PSIyMjAiIGN5PSI0NyIgcj0iNDciIGZpbGw9IiNmZmYiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCA0OGgyNjZ2NjVIMHoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA5IDE0NHEwLTgtNi0xMy02LTQtMTctNGwtMTIgMS03IDUtMiA3IDEgNSA1IDUgNyAzIDExIDMgMTQgMyAyNCA4IDE3IDEycTcgOCAxMCAxNWE1MyA1MyAwIDAgMS02IDQ3cS03IDEyLTI0IDE4LTE1IDYtMzggNi0yMiAwLTM5LTYtMTctNy0yNi0yMXQtOS0zNWg0NGw0IDEzcTQgNiAxMCA4IDcgMyAxNiAzbDEyLTIgOC01cTMtMyAzLTggMC0zLTMtN2wtOC01LTE1LTUtMTctM3EtMjQtNS0zNy0xNy0xMy0xMS0xMy0zMiAwLTE3IDktMjl0MjUtMTkgMzYtNyAzNiA3IDI0IDIwcTkgMTIgOCAyOXoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjE3IDB2MjY2aC02NVYweiIvPjwvc3ZnPg%3D%3D"></a>
  <a href="package.json"><img alt="Version" src="https://img.shields.io/github/package-json/v/rajebdev/ompchamber?label=version&color=3f3f46&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjExNyAxMzMgMjc4IDI3OCI%2BPGcgZmlsbD0iI2Y5NzMxNiI%2BPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTQ1IDE4NGMtMTYgMC0yOCAxNC0yOCAzMnY0NGMwIDE4IDEyIDMyIDI4IDMyaDI0YzE2IDAgMjgtMTQgMjgtMzJ2LTQ0YzAtMTgtMTItMzItMjgtMzJabTAgMjZoMjRxNCAwIDQgNnY0NHEwIDYtNCA2aC0yNHEtNCAwLTQtNnYtNDRxMC02IDQtNiIvPjxwYXRoIGQ9Ik0yMTEgMTg0aDI2bDIxIDU0IDIxLTU0aDI2djEwOGgtMjR2LTcybC0xNiA0MGgtMTRsLTE2LTQwdjcyaC0yNFoiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0zMTkgMTg0aDQ0cTI5IDEgMzAgMzF2OHEtMSAzMC0zMCAzMWgtMjB2MzhoLTI0Wm0yNCAyNGgxN3E5IDAgOSA4djZxMCA5LTkgOGgtMTdaIi8%2BPC9nPjwvc3ZnPg%3D%3D"></a>
</p>

<p align="center">
  <a href="AGENTS.md">Architecture</a> ·
  <a href="DESIGN.md">Design</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="docs/plugin-platform-plan.md">Plugins</a> ·
  <a href="https://github.com/rajebdev/ompchamber/issues">Issues</a>
</p>

![OMPChamber — session sidebar, streaming timeline with tool cards, and the Files panel](docs/assets/hero-dark.png)

## What it is

The browser view onto a live `omp` install. It is not a terminal wrapper: the chamber reads
omp's own session JSONL, project registry, config and subagent transcripts, folds them into one
live view, and writes back through omp's RPC mode.

```bash
ompchamber serve                # production server + prebuilt client on :3000
bun run dev                     # source checkout: one process, HMR, no build step
```

- **One process.** Elysia serves the API and the client bundle, and the agent event stream is a
  first-class WebSocket route on that same listener (SSE as fallback) — no second server, no proxy,
  no separate client watcher.
- **Two data modes.** `MOCK=false` (the default, also when unset) runs on the real SQLite database
  and your real workspace; `MOCK=true` swaps in bundled demo datasets. Every screenshot and
  recording on this page was captured in `MOCK=true`.
- **Bun only.** The server imports `bun:sqlite` and `Bun.YAML`, the client is bundled by `Bun.build`,
  and sessions, config and updates shell out to the `omp` binary.

## Feature tour

![Feature tour — timeline, Files, Search, Source Control, a real PTY, Context & Telemetry, Wiki, and the theme cycle](docs/assets/tour.gif)

<sub>Full-quality recording (MP4, 57s): [docs/assets/tour.mp4](docs/assets/tour.mp4) · theme cycle in motion: [docs/assets/themes.gif](docs/assets/themes.gif)</sub>

| | |
|---|---|
| ![Files panel](docs/assets/panel-files.png)<br>**Files** — project tree with git markers, cut/copy/paste, drag-to-move, and a file open in the editor | ![Search panel](docs/assets/panel-search.png)<br>**Search** — ripgrep-backed streaming results, virtualized list, in-file jump and replace preview |
| ![Source control](docs/assets/panel-git.png)<br>**Source Control** — changes, commits, branches, tracking, stash, and merge/rebase conflict resolution | ![Editor and diff](docs/assets/panel-diff.png)<br>**Editor & diff** — split or unified, full-code or diff-only, word wrap, find/replace, command palette |
| ![Terminal](docs/assets/panel-terminal.png)<br>**Terminal** — a real PTY (one shell per terminal id, scrollback replayed on reload) | ![Context and telemetry](docs/assets/panel-context.png)<br>**Context & telemetry** — context window use, cache hit rate, cost, per-message breakdown |
| ![Wiki](docs/assets/panel-wiki.png)<br>**Wiki** — reads a project's GitHub/GitLab wiki over git, with its own `_Sidebar` as navigation | ![Todos](docs/assets/panel-todo.png)<br>**Todos** — the session's live list, all five omp statuses, blockers and per-phase progress |
| ![Plan](docs/assets/panel-plan.png)<br>**Plan** — the plan artifact an omp session is working from, rendered as a document | ![Usage](docs/assets/panel-usage.png)<br>**Usage** — provider balance, plan windows, saved resets, per-model token spend |
| ![Your browser](docs/assets/panel-user-browser.png)<br>**Browser (yours)** — a private iframe with real history and device presets | ![Agent browser](docs/assets/panel-agent-browser.png)<br>**Browser agent** — a live screencast of the tab the agent is driving |
| ![Panel plugins](docs/assets/settings-panel-plugins.png)<br>**Panel plugins** — every view is a plugin, including the eleven bundled ones | ![Providers](docs/assets/settings-providers.png)<br>**Providers** — dialects, discovery, hand-added models, credential removal |
| ![Mobile view](docs/assets/mobile.png)<br>**Mobile view** — the same session on a phone: chat, sessions drawer, and the panel drawer | ![Light theme](docs/assets/hero-light.png)<br>**Any palette** — 45 light and dark themes, applied to the whole console |

- **Chat timeline** — streaming thinking blocks (with omp's narrated prose promoted to answer
  text), a structured renderer per tool (bash, LSP, AST edit, `proc://` services, `wait` with a
  clock and progress, mermaid diagrams you can zoom), usage footers, a persistent follow-up queue,
  a jump rail that reaches any user turn, drag-and-drop attachments, one-shot auto-titling, and
  in-place undo that rewinds a session by truncating its JSONL behind a confirmation step.
- **Steering, not cancelling** — a mid-run prompt is delivered INTO the running turn
  (`POST /api/agent/:id {type:'steer'}`); the answer you were watching survives. A subagent can be
  steered or stopped on its own, from the roster or its transcript.
- **Side questions** (`/btw [question]`) — replaces the composer with a panel that answers from a
  private copy of the session file, so the parent transcript is never written; a topic can be
  promoted into a session of its own, and it runs the same tool cards, thinking and usage rows as
  the chat.
- **Workspace sidebar** — folder → session tree off omp's project registry, with search, sort,
  archive, per-session stream status, subagent rows, scheduled tasks, and a New Workspace dialog
  that can register a directory or clone a repository.
- **Eleven right-panel views** — context & telemetry, files, search, source control, wiki,
  terminal, your browser, the agent browser, usage, todos and plan; each remembers its own width
  per session, and the bar is drag-reorderable.
- **A plugin platform, not a fixed panel list** — a panel plugin can ship a Preact view, a server
  half, its own storage, RPC methods, a realtime topic and declared settings. Three are bundled
  (`Runner` — 18 command sources across 15 toolchains — plus `Stats` and `Session Info`),
  and they are auto-synced on upgrade.
- **Full omp settings surface** — engine config keys (generated from omp's own schema, 554
  settings across 10 tabs), providers, agents, `AGENTS.md` / `RULES.md`, slash commands, MCP
  servers with live connection tests, skills and the skills catalog, token usage, notifications,
  and dictation.
- **Self-update** — `ompchamber update` installs the latest version from npm, and **About → Updates**
  does the same from the console, restarting the server and reloading the page into the new build.
- **Opt-in password, HTTPS and session revocation** — the UI is open by default and locked only when
  you ask for it (`--ui-password` / `OMPCHAMBER_UI_PASSWORD`), with `--tls` for a self-signed HTTPS
  listener and `POST /api/auth/revoke` to end every session at once. See [Security](#security).
- **Tray icon and start at login** — `serve --tray` / `--startup`, with the icon as a child of the
  server so it can never outlive it.
- **Dictation** — the composer's mic button runs omp's own speech-to-text worker (no API key, a
  local model) and streams the transcript into the draft.

## Themes

![The palette picker in Settings → Appearance](docs/assets/settings-themes.png)

![Eight of the 45 palettes, same surface](docs/assets/theme-grid.png)

45 palettes in one catalog (`src/shared/lib/theme/`): the chamber's own three (`paper`, `contrast`,
`one-dark-pro-soft`) and 21 light/dark pairs — Catppuccin, Gruvbox, Tokyo Night, Nord, Dracula,
Solarized, Kanagawa, Vesper, Ayu, Monokai and more. Switching repaints everything, syntax
highlighting and Mermaid diagrams included, through one writer (`applyDocumentTheme`) that sets
`data-theme` and announces it — so an open editor, a live terminal and a diagram in the transcript
all follow with no reload.

![Theme cycle in motion](docs/assets/themes.gif)

## Install

OMPChamber is published to npm and runs on Bun, not Node:

> **Bun only** — the server imports `bun:sqlite` and `Bun.YAML`, neither of which Node can load.
> Bun 1.4 or newer is required.

> **omp required** — every live capability (agent sessions, omp config, session state, updates)
> shells out to the `omp` binary, so `serve` refuses to start when it is not on `PATH` (or set via
> `OMPCHAMBER_OMP_BIN`). `MOCK=true` is the only mode that runs without a real omp install.

```bash
bun add -g ompchamber     # puts the `ompchamber` command on your PATH
ompchamber serve         # start the server on :3000
```

The published tarball carries the source, the CLI and the prebuilt client bundle, so there is no
build step after install. `npm install -g ompchamber` works too — the `ompchamber` bin is a Bun
script, so Bun still has to be on `PATH`.

### From source

```bash
git clone https://github.com/rajebdev/ompchamber.git
cd ompchamber
bun install
bun run build                        # dist/client — the only build artifact

bun run start                        # NODE_ENV=production bun run src/server/index.ts
bun link                             # then: ompchamber status
```

> Without `dist/client` the server answers `503` with the exact command to run — never a bare `500`.

### Updating

```bash
ompchamber update --check        # report only: current version, latest release
ompchamber update                # install it, then restart a running instance
ompchamber update --force        # reinstall even when already up to date
```

A **bun global** install is refreshed with `bun add -g ompchamber@<version>`; a **git checkout** is
fast-forwarded to the release tag and rebuilt. Uncommitted work is never merged over (the update asks
you to commit or stash first), and an install owned by another package manager is left alone and told
which command to run.

A server OMPChamber did not start is never restarted: `bun run dev`, `bun run start`, a manual
`bun src/server/index.ts` and instances owned by a supervisor (systemd, pm2, a container) all record
themselves as `direct`, so the update leaves them running and says so. `--no-restart` turns the
restart off entirely. The console's **About → Updates** runs the same install, restarts the instance
serving that console, and reloads the page once the replacement answers on the same port.

## CLI

`ompchamber [COMMAND] [OPTIONS]` — `serve` is the default command.

| Command | Purpose |
|---|---|
| `serve` | Start the web server (daemon by default) |
| `update` | Install the latest version from npm, then restart the instance it started |
| `stop` | Stop the instances the CLI started — `--port`/`--all` to stop any |
| `restart` | Stop, then start again — leaving servers started from source alone |
| `status` | Report whether an instance is running |
| `logs` | Print or follow the server log |
| `plugin` | Build, type, scaffold or list panel plugins |

| Option | Purpose |
|---|---|
| `-p, --port <port>` | Web server port (default `3000`); scopes `status`/`stop`/`restart`/`logs` |
| `--host <address>` (`--hostname`) | Bind address (default `127.0.0.1`) |
| `--lan` | Bind to `0.0.0.0` for LAN access (warns when the traffic is unencrypted) |
| `--tls` | Serve HTTPS from a self-signed certificate, generated once into `~/.ompchamber/tls/` |
| `--tray` | Show a menu-bar/notification-area icon for this server |
| `--startup` | Start the server at login (and show the tray icon now) |
| `--no-startup` | Remove the login entry |
| `--ui-password [value]` | Require a password for the browser UI; generates one when the value is omitted |
| `--no-ui-password` | Ignore `OMPCHAMBER_UI_PASSWORD` for this start |
| `--prod` | Accepted for compatibility — production is the default |
| `--dev` | Run the dev server from source (HMR, unminified) instead |
| `--foreground` (`--no-daemon`) | Run in the foreground (no daemon) |
| `--all` | Apply the command to every running instance |
| `-c, --check` | Report whether a newer release exists without installing it |
| `--force` | Reinstall even when already up to date |
| `--no-restart` | Do not restart a running instance after updating |
| `-f, --follow` / `-n, --lines <count>` | Tail the log, optionally from a line count |
| `--json` / `-q, --quiet` | Machine-readable output / suppress non-essential output |

### Tray icon and start at login

`ompchamber serve --tray` puts an OMPChamber icon in the menu bar (macOS) or the notification area
(Windows, Linux). `--startup` additionally registers the server to start at every login, and
`--no-startup` removes that registration:

```bash
ompchamber serve --tray          # start the server with a tray icon
ompchamber serve --startup       # also start at every login
ompchamber serve --no-startup    # remove the login entry
```

The icon's menu reflects the server as it is **right now** — rebuilt on every open: Open Console,
Open Logs, Start at Login / Disable Start at Login, Quit OMPChamber.

- **The tray is a child of the server.** It exits when the server does (it watches its parent), so a
  killed or crashed server leaves no orphan icon, and **Quit OMPChamber signals the server** — the
  icon and the console end together. There is no pid file, no `status`/`stop` for the icon, and
  nothing to keep in sync: the process tree is the registration.
- **The login entry runs `serve --foreground`.** launchd reaps a job's whole process tree when the
  job's program exits, so an entry that ran a detached `serve` (which returns once the health check
  passes) produced no server at all. In the foreground the CLI is the long-lived job, the server is
  its child, and the tray is the server's child. Verified against `launchctl print`: the entry is
  `state = running` with the CLI as its program.
- **macOS** registers `~/Library/LaunchAgents/dev.ompchamber.tray.plist` (`RunAtLoad`, no
  `KeepAlive` — a server stopped on purpose stays stopped). **Linux** writes
  `$XDG_CONFIG_HOME/autostart/ompchamber-tray.desktop`, which every freedesktop session reads.
  **Windows** sets the HKCU `…\CurrentVersion\Run` value through `reg`, so registering never needs
  elevation.
- **What draws the icon is the platform's own tray API**: an AppKit status item on macOS (via
  `osascript -l JavaScript`), `System.Windows.Forms.NotifyIcon` on Windows, and `yad`/`zenity`
  `--notification` on Linux. Only Linux can lack a client — the icon is then skipped with the
  package to install in the log, and the server keeps running.
- `--startup` without `--tray` is a supported shape: the login-started server comes up without an
  icon.

### Ports and multiple instances

One port is served by exactly one process, and `bun run dev`, `ompchamber serve` and the production
server all default to `3000`. **A starting instance never stops another one** — if the port is taken
by OMPChamber, the newcomer reports who holds it and exits non-zero so you can pick another port:

```bash
ompchamber serve --port 3001        # CLI flag
OMPCHAMBER_PORT=3001 ompchamber serve
PORT=3001 bun run dev              # or: PORT=3001 bun run start
```

- Nothing is ever signalled to free a port; `ompchamber stop --port 3000` is the deliberate way.
- A process that is **not** OMPChamber is never signalled either: the server names the port and
  prints the `lsof -nP -iTCP:<port> -sTCP:LISTEN` command to identify it.
- `bun run dev` hot reload is unaffected: `--hot` re-evaluates the entry inside the running
  process, and a port held by that process is recognized as its own.
- `status` and `logs` report **every** live instance by default; `--port <port>` narrows them to one.
  `stop` acts on the instances the CLI started, and `restart`/`update` skip the rest: `bun run dev`
  is a supervisor whose only job is to mirror the script under it, so stopping that server exits
  the dev loop with it. Name the instance — `ompchamber stop --port <port>`, or `--all` — to end
  one anyway.

The server writes `~/.ompchamber/run/<port>.json` (`pid`, `host`, `mode`, `launchMode`, `startedAt`)
once it owns the port, which is how `status`/`stop`/`logs` also see servers started by `bun run dev`
or `--foreground`. `launchMode` is derived from the process's **argv**, never from an environment
variable — env is inherited, so a `bun run dev` started inside an OMPChamber shell would otherwise be
replaced by an update. Records left by a killed server are pruned once their PID stops answering.

- `stop` reports what actually happened. The record is dropped only once the process is gone, so a
  stop that could not end the server keeps it — `ompchamber status` still finds the instance, the
  message says so, and the command exits non-zero. Deleting the record over a live process was how a
  failed stop turned into a deadlock: `status` said "not running" while `serve` refused the port.
- A PID whose identity cannot be read (Windows cannot read another process's command line, so every
  PID there reads back as unverified) is resolved through the **port** instead: `/api/health` names
  the instance serving it. Only when the port names a different PID — a recycled PID, a foreign
  listener — is the record treated as stale and cleared without signalling anything.

## Configuration

Environment variables, read from `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `localhost` | Server bind address |
| `MOCK` | `false` | `true` = demo datasets, `false` = real SQLite + workspace only |
| `SYNC_WORKSPACE` | `true` | Seed the workspace list from discovered omp projects — only while the list is still empty (one-time bootstrap; a curated list is never appended to) |
| `OMPCHAMBER_DATA_DIR` | `~/.ompchamber` | CLI registry, logs, database, wiki mirrors and TLS certificate root |
| `OMPCHAMBER_PORT` / `OMPCHAMBER_HOST` | — | Defaults for the CLI when no flag is passed |
| `OMPCHAMBER_UI_PASSWORD` | — | Require a UI password (see [Security](#security)); erased from the environment at boot |
| `OMPCHAMBER_DB_PATH` (`DB_PATH`) | `~/.ompchamber/db.sqlite` | SQLite database path |
| `OMPCHAMBER_BUN` | — | Explicit Bun binary for the CLI to spawn |
| `OMPCHAMBER_OMP_BIN` | — | Explicit `omp` binary path |
| `OMPCHAMBER_MARKETPLACE_DIR` / `OMPCHAMBER_BUNDLED_MARKETPLACE_DIR` | — | Override where plugin marketplaces are read from |
| `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` | `~/.omp` | Oh-My-Pi config root overrides |
| `SKILLS_API_URL` | `https://skills.sh` | Skills catalog source |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org` | Registry the update check reads |

Runtime state, sessions and settings live in SQLite (`~/.ompchamber/db.sqlite`), the single source
of truth for persisted settings. Per-session UI state (open tabs, panel widths, the picked repo,
drafts) lives beside it, keyed by session id, so a reload restores the layout that session was left
in.

## Security

**Off by default.** A plain `bun run dev` requires no password, and no file on disk can change that:
the password is supplied per run and hashed in memory. Only a session *signing* secret is persisted
(`~/.ompchamber/auth.json`, mode 0600), so `bun run --hot` does not sign you out on every save while
nothing durable can enable authentication on its own.

```bash
ompchamber serve --ui-password my-secret    # or OMPCHAMBER_UI_PASSWORD
ompchamber serve --ui-password              # generates one and prints it once
ompchamber serve --tls --ui-password …      # HTTPS, cookie gains Secure
```

- **Password** — argon2id, verified in constant time. Login is throttled per socket address
  (10 per 5 minutes, then a 15-minute lockout); `x-forwarded-for` is deliberately not trusted, so a
  forged header cannot buy a fresh budget.
- **Sessions** — a stateless HMAC token in a cookie named per port (`omp_session_<port>`), because
  browsers key a cookie jar by host and ignore the port. `HttpOnly`, `SameSite=Lax`, and `Secure`
  whenever the request arrived over https — including through a proxy that sets
  `x-forwarded-proto`. Changing the password or calling `POST /api/auth/revoke` rotates the signing
  secret and ends every session everywhere. The token binds to a key derived from the password, so a
  restart with the same password keeps your session and a different one kills it.
- **TLS** — `--tls` generates a self-signed certificate (SAN covering `localhost`, `127.0.0.1` and
  the machine's LAN addresses) into `~/.ompchamber/tls/`. Your browser warns once, then the
  connection is encrypted. Without it, a password and the session cookie cross the network in
  cleartext, which is what `--lan` warns about.
- **No TLS locally?** A tunnel terminates TLS at the edge and needs no certificate:
  `cloudflared tunnel --url http://127.0.0.1:3000`. Verified end to end — login, the API gate, SSE
  and the terminal WebSocket all work through the public URL, in dev and in the production build.
- **Local sockets are origin-checked.** The terminal PTY and dictation WebSockets verify the
  upgrade's origin with the same predicate, because both trigger real work on this machine.

Bind to loopback (the default) and reach it over SSH port-forwarding, a VPN, or a tunnel. Exposing
the port directly is the option with the least margin for error.

## Architecture

```text
src/
├─ client/    Preact UI — zero React packages
│  ├─ components/   layout, workspace, settings, mobile, common
│  ├─ hooks/        chat, workspace, ui, browser, models, settings
│  ├─ data/         mock datasets, samples, themes, model + agent catalogs
│  └─ tailwind.css  theme tokens (--theme-ink, --theme-paper, …)
├─ server/    Bun-only — Elysia routes, SQLite, omp RPC bridge, fs/git/terminal
│  ├─ routes/       one plugin per domain, mounted in routes/index.ts
│  ├─ lib/          omp session/subagent/config, panels, wiki, updates, lifecycle
│  └─ plugins/      SSR shell, static assets, compression, dev assets
├─ shared/    Imported by both — types, chat timeline folding, pure helpers
└─ cli/       ompchamber command (plain ESM, runs under Bun)

packages/
├─ plugin-sdk/  the panel-plugin contract (types, backend API, slots)
└─ ui/          the Preact kit a plugin builds against

marketplace/plugins/
├─ command-runner/  a repository's commands, 18 sources across 15 toolchains
├─ stats/           CPU and RAM of the whole omp stack
└─ session-info/    active workspace and a note per session
```

Non-obvious invariants worth reading before you edit:

- **`src/shared/**` must never import a `node:` builtin or `bun:sqlite`** — it also runs in the
  browser. Server-only helpers belong in `src/server/lib/**`.
- **Route modules keep the ported Remix shape** (`loader` for GET, `action` for mutations) so status
  codes stay identical; `action` owns method dispatch and returns its own `405`.
- **Every internal import uses the `@/` alias**, folders mirror component names in kebab-case, and
  every `.ts`/`.tsx` file stays under 350 lines.
- **Every right-panel view is a plugin**, including the eleven the chamber ships: one catalog merges
  the built-ins and the installed ones, so a view cannot be a table in one layout and a fetch in the
  other.

[`AGENTS.md`](AGENTS.md) is the normative reference for all of the above — the invariants behind the
panels, the BTW subsystem, the PTY terminal, the plugin platform and the build/dev loop.

## Development

```bash
bun run dev            # watched server; the client bundle is built on demand
bun run dev:lan        # same, bound to the LAN
```

One process. Bun serves the HTML shell and bundles its assets itself, so there is no separate
client watcher to run and no build step before the first request: saving a server file restarts the
server, saving a client file is pushed to the browser over HMR (`import.meta.hot`, wired by Bun).
A dev server keeps the whole module graph open for HMR (~3.5k descriptors after one page load), so
`GET /api/health` reports `fds.open` and `ompchamber status` prints it — a long-lived session belongs
on a production server.

`bun run build` produces the production bundle — `scripts/build-client.ts` writes `dist/client`, which
`ompchamber serve` runs. The CLI builds it on demand the first time when it is missing, so a source
checkout needs no manual build; `--dev` skips the bundle entirely.

Verification gates, all mandatory:

```bash
bun run lint                                                  # tsc --noEmit
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters        # no dead code
bun run build                                                 # production bundle
bun test                                                      # unit + route suites
bun run typecheck:e2e                                         # the Playwright specs
```

The browser layer is Playwright (`tests/e2e/`, 22 specs, `*.e2e.ts`) and boots a real server
subprocess against an isolated temp root per spec; `bun run test:e2e` runs it, and CI runs it on
every push to `main` plus label-gated pull requests.

The screenshots, GIFs and the MP4 in [`docs/assets`](docs/assets) are captured from a scratch
checkout running `MOCK=true` with Playwright, so they contain demo data only — never a real
workspace. The three logos in the badge row at the top live in
[`docs/assets/brand`](docs/assets/brand) — Elysia and Shiki have no Simple Icons slug and shields
rejects a remote `logo=` URL, so each mark is inlined in the badge as a base64 data URI. Their
provenance, licences and recolouring are documented beside them, and
`docs/assets/brand/badges.test.ts` fails if a mark and its embedded payload drift apart.

## Releasing

A push to `main` cuts the release — there is no manual version bump
([`.github/workflows/release.yml`](.github/workflows/release.yml)). The workflow calls the same
reusable gates a pull request runs, then publishes as the last jobs of its own run:

```text
gates → e2e → packages → packages-publish
                       → marketplace → app → app-publish
```

1. `semantic-release` reads the Conventional Commits since the last tag, decides the next
   version, writes it into `package.json` and a `## [x.y.z]` section of `CHANGELOG.md`, commits
   both, then creates the tag and the GitHub Release.
2. `publish-app.yml` checks out the tag, verifies it against `package.json`, typechecks, runs
   `bun test`, builds `dist/client`, packs a dry run, and runs `bun publish`. Publishing is the
   **last action of the release run** rather than a second run dispatched beside it, so a release
   cannot report success while its publish is still queued, still waiting on the `npm` environment,
   or already failed.
3. The same run releases `@ompchamber/plugin-sdk` and `@ompchamber/ui` FIRST (the app pins them, and
   a `workspace:` spec is substituted from `bun.lock`), then bumps the bundled marketplace plugins
   by their own commit history — a bundled plugin's manifest version is the whole delivery
   mechanism, since `syncBundledPlugins` applies a new copy only when the store's version is
   strictly newer.

What a commit does to the version is one table, in
[`release/release-rules.js`](release/release-rules.js), and `release/bump.test.js` asserts it:

| Commit | Version |
| --- | --- |
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `feat!` / `fix!` / `perf!` / `refactor!`, or a `BREAKING CHANGE:` footer | major |
| `docs`, `refactor`, `chore`, `style`, `test`, `build`, `ci` | no release |

Two of those rows exist because the toolchain's own defaults are wrong here: a `!` on a type that
cannot carry a breaking change (`chore!`, `docs!`, an unknown `foo!`) used to cut a major version
through the analyzer's built-in `{ breaking: true }` fallback, and the parser's note regex is
case-insensitive, so any body line starting with `breaking change` — colon optional — counted as a
breaking note. The second one is not hypothetical: a `docs` commit whose body wrapped onto
`breaking-change (!) footer` cut **v1.0.0** where the `feat`s in the range asked for v0.9.0, and the
changelog printed that prose as its breaking note. Both are fixed in `release/release-rules.js`, and
both are locked by `release/bump.test.js`.

A `BREAKING CHANGE:` footer is therefore read only in uppercase, and only where the type allows it.

Two things to set up once and one to never do:

- GitHub environment **`npm`** with a secret `NPM_TOKEN`: a granular npm token with read/write on
  `ompchamber` (and the two packages), 2FA bypass enabled and the `publish and stage` action (a
  stage-only token is rejected — Bun has no `npm stage publish`).
- A failed publish is retried with `gh workflow run publish.yml -f tag=vX.Y.Z`, which leaves the
  release itself untouched. `publish.yml` is now only a TRIGGER (a published release, or that
  dispatch); the steps it runs live in `publish-app.yml`, which `release.yml` also calls.
- **Never** write a skip marker (`[skip ci]`, `[ci skip]`, `[no ci]`) into a message pushed to
  `main` — it scans the whole message and silently skips the release run. Only the bot's release
  commit carries one, so that it does not re-trigger the workflow.

## Contributing

Issues and pull requests both get an automated first pass: a GitHub App runs the `omp` agent headlessly
to triage a new issue and to review a pull request, and its verdict is published as a `review:*` label.

- [`CONTRIBUTING.md`](CONTRIBUTING.md) is the policy — the four mandatory gates, the pull request
  sections the reviewer checks, what counts as evidence, and the label a review moves through.
- The command surface is `@<bot> help | review | summarize | triage | reproduce` as the first line of a
  comment. Run the **bot config check** workflow to print the name this repository answers to.
- Bugs go through the issue form; requests through the feature form. Design and scope stay the
  maintainer's call, and `AGENTS.md` is the normative reference for the code rules.

## License

No license file is included. The source is public on GitHub and published to npm, but all rights are
reserved by the author — no license is granted for redistribution or reuse.

See [CHANGELOG.md](CHANGELOG.md) for the release history.
