# Command Runner — a right-panel plugin that lists and runs a repository's commands

A right-panel view that reads the command sources in the selected repo scope
(`package.json` scripts, `Makefile` targets, `justfile` recipes, `Taskfile.yml`
tasks), renders them as **rows grouped by file**, and runs one on click — in the
foreground or in the background, with its output shown live.

**Shipped as a plugin**, not as a built-in view: `marketplace/plugins/command-runner`.
It installs from the bundled marketplace like any other panel plugin, is
switchable from the activity bar's right-click menu and from Settings → Panel
Plugins, and ships as two bundles (`dist/app.js` for the panel, `dist/server.js`
for the process registry).

Status: **implemented.** P0–P6 landed; this file is kept as the record of what was
built and WHY, and the corrections below are the places the plan was wrong before
the code was written. Every claim about this repo was read from this tree; every
claim marked *measured* was run on this machine (Bun 1.4.2, macOS). The shipped
plugin's own documentation is `marketplace/plugins/command-runner/README.md`.

## 1. Identity

| | |
|---|---|
| Plugin id | `command-runner` |
| Plugin name | `Runner` |
| Panel title | `Commands` |
| Activity bar reads | `Commands — Runner` (the bar renders `<panel title> — <plugin name>`) |
| Directory | `marketplace/plugins/command-runner/` |
| Visible surface | ONE `rightPanel` registration |
| Invisible surface | ONE `contentScript`, which renders nothing (see §9) |
| Activity-bar mark | `icon.svg`, a framed play button (Lucide `square-play`). The first draft drew a shell prompt and collided with the `terminal` view's own glyph — see §14 |
| Registration sizing | `minWidth: 420` — a command row plus a log column wraps below that; the fraction stays the slot default |

**A `marketplace.json` entry is not required to ship it.** The bundled store's
"Available" list is a DIRECTORY read (`readBundledCatalog` walks
`<package>/marketplace/plugins/*` and reads each manifest), and `install` resolves
`<bundled>/plugins/<id>` directly. The repo's `marketplace/marketplace.json` is
read by nothing in this repo (verified: no `src/`, `scripts/` or test reference
reads it; the catalog file the SCAN reads is the working one under
`~/.ompchamber/marketplace/`). So the entry there is documentation for a human —
add one for consistency with the two shipped plugins, and do not expect a missing
one to hide the plugin.

The name is one decision in three places (folder, manifest, `marketplace.json`
entry). `Scripts — Runner`, `Tasks — Task Runner` are equally fine; nothing else
in the design depends on it.

## 2. The requirements, and what each one becomes

| Requirement | Design |
|---|---|
| A list of the repo's commands, **rows, not a dropdown** | The panel body is a scroll container of **groups**: a group header per command FILE (repo-relative path), then one row per command. A row is the whole click target for Run; a per-row menu is not needed. |
| Run it, **background and output as two toggles** | Two per-COMMAND toggles on each row (icon-only, `aria-pressed`), orthogonal by construction (§7.3). The plan put them in the header; the requirement is per command, and §14 records the change. |
| **Show the output** | A per-run bounded ring buffer on the server + a `GET /logs` route the open log reads, re-read whenever the run's byte count moves (§5.3). The run LIST is live off the plugin's own realtime topic. |
| **Grouping by file** | The scan returns `groups[]`, each naming its file, its directory and its detected kind; the UI renders exactly that order. Nothing is flattened. |
| A **git repo dropdown in the panel header**, synchronized with the other panels | The kit gains a repo-scope service + hook + picker (§8), reading and writing the SAME session slot the Files / Search / Source Control / Terminal panels already share (`workspace.activeRepo`). |
| **Switching repo force-stops every run, background or not** | A scope watcher in the plugin's content script + a sweep when the panel mounts + the scope recorded on every run (§9). |

## 3. Findings that decide the design

**F1 — The kit cannot read the repo scope, so the dropdown is a kit change, not
plugin code.** `installUiKit` (`src/client/lib/plugins/kit.ts`) prefixes the
string-typed session services with `plugin.`:

```ts
getSessionValue: (sessionId, key) => getSessionValue(sessionId, `plugin.${key}`),
setSessionValue: (sessionId, key, value) => setSessionKey(sessionId, `plugin.${key}`, value),
```

(`getSessionJson` / `setSessionJson` — the typed pair `useSessionState` uses — are
NOT prefixed, which is a separate inconsistency and not what matters here.) So a
plugin reading the shared pick through the kit's string service reads
`plugin.workspace.activeRepo`, which nothing writes. The shared pick is a host
concept (a root-relative path, host-validated) and has to be exposed as a service
(§8). Without it, "the dropdown synchronized with the other panels" is
unreachable from a plugin.

**F1b — `useSessionState` (the typed pair) writes into the HOST's key space, so a
plugin's keys must namespace themselves.** Because `getSessionJson`/`setSessionJson`
carry no `plugin.` prefix, a plugin calling `useSessionState('layout.activeRightPanel', …)`
would read and clobber the host's own layout slot. Every plugin-side key in this
plan is therefore spelled `commandRunner.*` (§7.3), and the plugin never touches a
key it did not create. Worth fixing in the kit eventually (prefix the JSON pair
too); not required for this plan, and changing it now would move the keys of any
plugin already storing state.

**F2 — A plugin panel is UNMOUNTED while another view is on screen, so a
panel-only watcher cannot guarantee the force-stop.**
`WorkspacePanels` renders `if (!panel.builtin && !isActiveView) return null;` —
the built-ins stay mounted and hidden, a plugin does not. A repo switch made from
the Files panel while Commands is closed would leave the old repo's processes
running with no watcher alive. `contentScript` is the only contribution that
mounts independently of which panel is shown (§9).

**F3 — A plugin panel with no workspace is rendered but told `enabled: false`.**
`WorkspacePanels` computes `enabled: panel.liveWhileHidden ? hasActiveContext :
hasActiveContext && isActiveView`, and `hasActiveContext = !!activeProject`. The
catalog's `requiresWorkspace: false` for a plugin (resolve.tsx) only means the
entry is not HIDDEN without a folder — the body still receives
`enabled: false`, which is the host's "you have nothing to read" flag. So the
panel must render its own "No workspace folder" state and must not treat
`enabled: false` as "the user closed me": it is also false whenever another view
is on screen.

The phone disagrees, and the plugin has to tolerate both: `MobileRightSidebar`
computes `enabled: enabled || !activePanel?.requiresWorkspace`, so a plugin panel
(`requiresWorkspace: false`) is ALWAYS `enabled: true` there — even with no
workspace and even while it is the only mounted view. The two layouts therefore
hand a plugin different values for the same flag. The honest rule for a plugin is
to treat `enabled` as "you may read", never as "you are visible", and to derive
its own emptiness from `usePanelInfo().workspacePath`.

**And `enabled: true` does not imply a root.** `hasActiveContext = !!activeProject`
where `activeProject` is a FOLDER, while `rootPath` is `activeProject.project_path`
— and a folder registered without a `project_path` is a real state (the New
Workspace dialog creates one from a directory). So the desktop hands the panel
`enabled: true` with NO `rootPath`, and `usePanelInfo().workspacePath` is null for
the same reason. Both sources agree, which is what makes one empty state correct
for both: **the panel's emptiness is `!workspacePath`, never `!enabled`**. That is
also why the plugin must not gate its reads on `enabled` — a hidden-but-enabled
panel and a rootless-but-enabled panel are indistinguishable from that flag alone.

**F3b — `PluginBootstrap` is desktop-only, so on the phone a plugin has no
context and no content script.** `src/client/components/layout/desktop-layout/index.tsx`
mounts `<PluginBootstrap workspacePath={activeProjectPath} />`; the mobile layout
(`src/client/components/mobile/LayoutWrapper.tsx`) mounts none. Verified: nothing
under `src/client/components/mobile/**` imports `bootstrap` or calls
`setPluginContext`. The two things that still work there are the ones a hook does
for itself — `MobileRightSidebar` calls `usePanelCatalog()` → `usePanelRegistry()`
→ the `panels` topic → `adoptPanelRegistry`, so the bundles DO load and the
panel DOES render. What is missing is everything `PluginBootstrap` exists for:
`usePanelInfo()` answers the kit's module default
(`{ sessionId: null, workspacePath: null, theme }`) because nothing published the
context, and `useContentScripts` never runs, so no content script mounts. The
plugin is therefore half-dead on a phone — the panel draws, the scope watcher
(§9) does not — until this is fixed (§10 P0).

**F4 — A chamber restart would orphan every command.** The plugin's runs are
`Bun.spawn({ detached: true })` children, and `detached` is exactly what makes a
group kill possible — but a detached child does NOT die with its parent.
`src/server/index.ts`'s `SIGTERM`/`SIGINT` handler calls
`stopDiscoveryRootsWatch()`, `stopScheduleRuntime()`, `app.stop()` and
`process.exit(0)`; `disposeAllPlugins()` exists and is called from **tests only**
(verified: `src/server/routes/panels/panel-routes.test-util.ts`). A chamber
restart therefore leaves every dev server the plugin started running. §10 P0
wires the shutdown path.

**F5 — `Bun.Glob`'s `ignore` option does not exclude `node_modules`.** Measured
on Bun 1.4.2 over a fixture with four `package.json` files — at the root, under
`a/`, under `a/node_modules/x/`, and under `b/dist/`:

```
new Bun.Glob('**/package.json').scanSync({ cwd: fixture, onlyFiles: true,
  ignore: ['**/node_modules/**'] })
→ [ "a/node_modules/x/package.json", "a/package.json",
    "b/dist/package.json", "package.json" ]
```

The identical four paths come back with `ignore` omitted and with `dot: false`.
The scan must therefore filter `node_modules` (and the other build directories)
by hand — a one-line filter on the returned relative path. A glob that silently
walks a 200 MB `node_modules` is the whole cost of this feature. Note `dist/` is
NOT excluded by the glob either, which is why the filter list is explicit rather
than a single `node_modules` test.

**F6 — Group kill works, and the reader sees the output produced before it.**
Measured on Bun 1.4.2 with a `detached: true` spawn whose stdout is piped:

```
Bun.spawn({ cmd: ['sh','-c','echo one; sleep 0.2; echo two; sleep 5; echo three'],
            stdout: 'pipe', stderr: 'pipe', detached: true })
→ process.kill(-proc.pid, 'SIGKILL') after 600ms
→ captured "one\ntwo\n", proc.exitCode === null, proc.signalCode === 'SIGKILL'
```

So `detached: true` + `process.kill(-pid, SIG)` is the mechanism, and the
partial output is readable through the same pipe the reader is already using.
Note the exit shape: a killed child reports `exitCode: null` and the SIGNAL, so
the run record must read `signalCode` and not render a null exit code as `exit
0`. This is the same shape `lib/fs/shell.ts` documents for its timeout kill.

**F7 — `Bun.YAML` is available in the server process.** Measured: `typeof
Bun.YAML.parse === 'function'` on 1.4.2. A `Taskfile.yml` is therefore one
dependency-free parse, not a new package.

**F8 — An SSE response survives the plugin HTTP path uncompressed, by design.**
`maybeCompress` (which the plugin route reaches through `adaptHandler`) returns
the response untouched when the content type is `text/event-stream` — the first
check after the accept-encoding guard — so a streamed response is never buffered
into a compressed body. Not needed for this design (§5.3 reads on demand), but it
means streaming is available later without a transport change.

**F9 — Declaring `capabilities` today would REFUSE the plugin.**
`HOST_CAPABILITIES` (`src/shared/lib/panels/capabilities.ts`) is `['panel']`, and
`missingCapabilities` refuses on anything else — `capabilities: ['server']` fails
the scan with `manifest requires capability "server" which this chamber does not
provide`. The two shipped plugins declare none. This plan adds one row
(`repo-scope`, §8) because the plugin genuinely requires it, and nothing else.

**F10 — The plugin's server bundle cannot import chamber source.** It is built by
`buildServerBundle` (`target: 'bun'`, everything bundled, no `plugins`) and loaded
by absolute path; `@/…` is not resolvable there. Measured: a fixture plugin whose
`src/server.ts` does `import { getDb } from '@/server/db.server'` fails the build
with `Could not resolve: "@/server/db.server"` — the same options `buildServerBundle`
passes. So the allow-list in `lib/fs/root.ts` and the cwd resolution in
`lib/terminal/session.server.ts` are NOT reusable — the plugin re-implements the
containment check it needs (§6.4). Its own tests are `*.test.ts` under the plugin,
which `bun test` picks up (measured: `bun test
marketplace/plugins/stats/src/format.test.ts` → 8 pass).

**F11 — `marketplace/plugins/*/src` is inside the root tsconfig's `include`**, so
`bun run lint` and `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`
cover the new plugin without a tsconfig change. Its imports are RELATIVE
(`./format`), which is the convention there — the `@/` alias rule in
`AGENTS.md` governs `src/`, not the plugin packages (verified against
`marketplace/plugins/stats/src/*`).

**F12 — The plugin's Tailwind classes need no `@source` directive.** `src/client/tailwind.css`
imports Tailwind with no source configuration, and Tailwind v4 auto-detects
sources from the project root (skipping gitignored paths). Measured on the built
sheet: `.-top-3{top:calc(var(--spacing)*-3)}` is present in
`dist/client/static/js/index-*.css` and `-top-3` appears NOWHERE under `src/` —
the only source of that rule is `marketplace/plugins/stats/src/ProcessTable.tsx`,
so plugin sources are already in the scan. The new plugin's classes are picked up
for the same reason. It must still use the THEME variables
(`bg-paper` / `text-ink` / `border-ink/10` / `text-error`), never a literal hex:
the plugin renders in the host's document and inherits `data-theme`.

**F13 — A plugin panel's `workspacePath` PROP is always `null`, so the workspace
must come from a hook.** `resolve.tsx` renders a plugin panel as
`<Component sessionId={props.sessionId ?? null} workspacePath={null} />` — the
prop is hardcoded null even though the layout HAS `rootPath` in the same props
object. So a plugin reading its own prop sees no workspace, while
`usePanelHost().rootPath` (the same object, published on the context) and
`usePanelInfo().workspacePath` (published by `PluginBootstrap`) both carry it.
`docs/panel-plugins/README.md` documents the rightPanel props as
`{ sessionId, workspacePath }` without saying it is always null, so the
documentation is currently wrong about this slot.

This plan reads the hook (§6.4) and never the prop. Worth fixing in the host
(`workspacePath={props.rootPath ?? null}`) — it is a one-word change that makes
the documented prop honest — but the plugin must work either way, and reading
the hook is what makes it work against today's host.

## 4. What the plugin does NOT reuse

**Not the terminal panel.** `src/server/lib/terminal/` owns one PTY per terminal
id, with a real shell, scrollback and a WebSocket per viewer. Typing a command
into it cannot answer "what is this run's exit code", cannot list the runs, and
would make a repo switch have to reason about a user's interactive shell. The
plugin owns its own children: `Bun.spawn`, a pipe per run, a process group per
run.

Consequence worth knowing: a plugin-spawned command appears in the **Stats**
panel's process table, because the sampler walks the ppid tree rooted at the
chamber's own pid (`marketplace/plugins/stats/src/sampler.ts`) — so a runaway
build's RAM is visible there without the plugin doing anything.

## 5. Contract

### 5.1 Manifest

`marketplace/plugins/command-runner/package.json`, under the `ompchamber` key:

```json
{
  "id": "command-runner",
  "name": "Runner",
  "version": "1.0.0",
  "description": "Lists a repository's commands and runs them.",
  "app": "dist/app.js",
  "server": "dist/server.js",
  "icon": "icon.svg",
  "capabilities": ["repo-scope"],
  "settings": {
    "logTailKb": { "type": "number", "label": "Log tail (KB)", "default": 64 },
    "maxRuns": { "type": "number", "label": "Concurrent runs", "default": 8 }
  }
}
```

`peerDependencies` are the optional-peer shape the docs prescribe
(`@ompchamber/plugin-sdk`, `@ompchamber/ui`, `preact`, all `optional: true`), the
same as the two shipped plugins. The `engines` key is deliberately absent: the
capability row is the precise gate for the one thing this plugin needs.

### 5.2 RPC (called by the plugin's own app half, over the existing route)

| Method | Input | Output |
|---|---|---|
| `list` | `{ root, repo }` | `{ groups: Group[], scannedAt, truncated }` |
| `start` | `{ root, repo, sessionId, commandId, background }` | `{ runId }` |
| `stop` | `{ runId }` | `{ stopped: boolean }` |
| `stop-others` | `{ root, repo, sessionId }` | `{ stopped: number }` |

**`stop-others` is defined by the scope it is handed, not by a diff.** It kills
every run of THIS session whose `scopeKey` differs from `${root}\0${repo}` and
leaves the ones in that scope alone — so calling it twice, or calling it when
nothing changed, is a no-op rather than a mistake. That is what lets the scope
watcher fire on every notification instead of tracking the previous scope (§9),
and it is why `stop` and `stop-others` are two methods: one names a run, the
other names a scope.

`output` is deliberately NOT part of `start`: it decides whether the panel opens
the log, which the server has no opinion about (§7.3). `background` IS sent,
because the server records it on the run so the panel can rebuild its own view
from the topic alone after a reload.

Every input is validated with a hand-rolled `~standard` schema, the pattern
`marketplace/plugins/session-info/src/server.ts` already uses — no validator
dependency.

**`start` takes a COMMAND ID, never a command line.** The id is
`<file>#<kind>:<name>` (`Makefile#make:build`, `package.json#script:dev`,
`justfile#just:test`), and the server re-resolves it against its own scan to
build the argv. A client-supplied shell string would make this route a
remote-command-execution endpoint reachable by anything holding the session
cookie; an id can only name a command that exists in a file the user's repo
already has. **Do not add a "run this string" method.**

**A user-defined command source is the `custom:` id namespace, and it keeps the
same rule.** Its id is `custom:<recordId>` and the text is read back out of the
user's own plugin storage server-side — so `start` still takes an id, and a
client cannot name a string it invented. That is what lets the feature exist
without becoming the endpoint this section forbids: the free text is DATA the
user already saved, not an argument in the request. It runs `sh -c <text>`, which
is the one place in this plugin a shell is involved; see `src/server/custom.ts`
and `src/server/resolve.ts`.

### 5.3 HTTP

One route, because it is a plain GET of a byte range and the kit's reader for
that is `useChamberFetch`:

```
GET /api/plugins/command-runner/http/logs?id=<runId>&tail=<bytes>
→ { id, status, exitCode, signal, bytes, ringBytes, truncated, text }
```

`truncated` here means the ring dropped output (`bytes > ringBytes`).

`text` is the LAST `tail` bytes of the run's ring buffer, ANSI-stripped (the
chamber's own proc panel strips ANSI for the same reason — `stripAnsiCodes` in
`src/shared/lib/code/ansi.ts`, which the plugin cannot import and re-implements
as a small local copy, per F10). Three numbers, because they answer three
different questions: `bytes` is the TOTAL the process produced, `ringBytes` is
how much the ring still holds (capped at 256 KB), and `text` is the tail of THAT.
The view can then say `showing the last 64 KB of 3.1 MB` instead of pretending
the tail is the whole log — and a run whose output exceeded the ring says so too.
An unknown id is a 404 with a reason, never an empty body.

(This `truncated` is not the `list` payload's: that one reports the SCAN hitting
its file/depth cap. Same word, two payloads, no shared field.)

**The URL is built from `usePluginId()`, never a literal.** A plugin that spelled
its own id into a path would break the day its id changed, and the kit already
hands the component the id it is running under. So the panel composes
`/api/plugins/${usePluginId()}/http/logs?id=…`.

**Read on the byte count, not on a timer.** `useChamberFetch` is called with
`pollMs: 0` and `enabled: logOpen`, and a `useEffect` keyed on the run's `bytes`
(from the realtime topic) calls the hook's `reload`. That is the honest gate: a
run that prints nothing costs zero requests, a build that streams costs one read
per publish, and a closed log costs nothing at all. A 500 ms timer would re-send
up to 64 KB to say nothing changed. `useRpc` is deliberately not the transport
here — it is POST-only and has no polling or visibility handling, so a log read
through it would hand-roll the three behaviours `useChamberFetch` already owns.

**That gate is why the topic publishes on output, THROTTLED.** `bytes` has to
move for the open log to re-read, so the run record publishes a metadata-only
summary when its buffer grows — coalesced to at most one publish per
`OUTPUT_PUBLISH_MS` (250 ms) per run, plus an immediate one on a state
transition. The alternative (publish only on transitions) leaves a streaming
build's log frozen at whatever it held when the run started, which is the one
thing the Output checkbox promises. The cost is bounded by the throttle, not by
the output volume, because the payload carries a byte COUNT and never the bytes.

### 5.4 The plugin's realtime topic (`plugin:command-runner`)

Transition-driven on STATE, throttled on OUTPUT — an immediate `publish` on
start, exit, stop and failure, and a coalesced one (≤1 per 250 ms per run) when
the buffer grows (§5.3 needs the byte count to move). The payload is metadata
only:

```ts
interface RunnerState {
  scopeKey: string | null;   // `${root}\0${repo}` of the runs' scope
  runs: RunSummary[];
}
interface RunSummary {
  id: string; sessionId: string | null; scopeKey: string;
  file: string;              // repo-relative path of the command file
  label: string;             // what the user clicked, e.g. `make build`
  cwd: string;               // repo-relative directory
  background: boolean;
  status: 'running' | 'exited' | 'stopped' | 'failed';
  startedAt: number; endedAt: number | null;
  exitCode: number | null; signal: string | null;
  bytes: number; error?: string;
}
```

Three properties this buys, all of which the alternatives cost:

- **A reload is safe.** `api.realtime.publish` writes the value into the
  process-wide map the topic resolver reads (`lib/plugins/realtime.server.ts`),
  so a client that subscribes later gets the CURRENT run list as its snapshot —
  no polling of the list, no lost state.
- **No output on the wire.** The payload carries a byte COUNT, never the bytes —
  a tail per publish would push up to 64 KB per run through the hub for a panel
  nobody is reading. Elapsed time is computed client-side from `startedAt`.
- **One subscription per open panel**, the same shape Stats uses. A publish with
  no subscribers is cheap by construction: the hub only fans out to
  `entry.subscribers` and only buffers while one of them awaits its snapshot
  (`hub.server.ts`), so a background run with the panel closed costs one map
  write per throttle window.

### 5.5 The run record (server, in memory only)

```ts
interface Run {
  id: string;                 // randomUUID()
  sessionId: string | null;
  scope: { root: string; repo: string }; scopeKey: string;
  file: string; cwd: string;  // absolute cwd = the command file's directory
  argv: string[]; label: string; background: boolean;
  proc: Bun.Subprocess | null;
  status: RunStatus; startedAt: number; endedAt: number | null;
  exitCode: number | null; signal: string | null;
  buffer: ByteRing;           // last RUN_BUFFER_BYTES (256 KB)
  error?: string;
}
```

Runs live only in the server process: a plugin reload, a disable, or a chamber
restart ends them (§10 P0 for the last one). Nothing is persisted — there is no
"run history" in this plan (§12).

## 6. Discovery

### The table now covers 15 toolchains, and adding one is one ROW

The first cut shipped four sources (`package.json`, `Makefile`, `justfile`,
`Taskfile.yml`) and claimed "adding a source is adding a row". That was not true:
a source needed three coordinated edits — the table, `labelFor`, and `argvFor` —
which is exactly the shape where two drift and a row says `npm run dev` while
running something else.

The detector now OWNS its argv and its label is `argv.join(' ')`, so the two cannot
disagree, and `scan.ts` asks the detector whether it needs the resolved package
runner (`needsRunner`) instead of testing `kind === 'package'` itself. The table is
split by family under `src/server/detectors/` (`js`, `make`, `python`, `native`)
and assembled in `table.ts`; `package.json` stays FIRST, where it has always been.

A detector may also read more than its own file — `go.mod`'s commands are the
`cmd/<name>` DIRECTORIES beside it, and Laravel is recognised by the `artisan`
next to a `composer.json` — through a `DetectorContext` whose directory listings
are memoized for one scan.

### 6.1 The detector table

One row per source. A row is `{ id, filenames, parse }`; adding a source is
adding a row, never a branch at a call site — the same rule
`provider/dialect.ts` follows.

The plugin's own layout (every path below is under
`marketplace/plugins/command-runner/`, and no file imports the chamber's `src/` —
F10):

```
package.json  tsconfig.json  icon.svg  README.md
src/app.tsx        the panel + the content script
src/panel/         the panel body, rows, log view
src/detect/        one file per source + the table
src/scan.ts        the bounded walk
src/runner.ts      spawn / stop / the run registry
src/server.ts      the RPC + HTTP surface
src/ring.ts        the byte ring
```

| Kind | Files | What is listed |
|---|---|---|
| `package` | `package.json` | every key of `scripts` |
| `make` | `Makefile`, `makefile`, `GNUmakefile` | targets: a line matching `^([A-Za-z0-9._-]+)\s*:(?!=)`, excluding names starting with `.` and targets containing `%` |
| `just` | `justfile`, `Justfile`, `.justfile` | recipe headers: `^(?:@?[A-Za-z0-9_-]+)(?:\s+[^:]*)?:\s*(?:#.*)?$`, excluding `:=` assignments and `[attributes]` blocks |
| `task` | `Taskfile.yml`, `Taskfile.yaml` | `Object.keys(Bun.YAML.parse(text).tasks ?? {})` |

The parsers are deliberately shallow and are unit-tested against the shapes that
actually appear: a `Makefile` with `.PHONY`, a variable assignment containing a
colon (`SRC := a:b`), a continuation line, and a `justfile` with a `set shell :=`
assignment are the cases that make a naive regex list a variable as a command.

### 6.2 The walk

From the scope directory, bounded and filtered by hand (F5):

- skip a path any of whose segments is in `node_modules`, `.git`, `dist`,
  `build`, `out`, `.next`, `coverage`, `target`, `vendor`;
- max depth 4, max 200 command files; hitting either sets `truncated: true`,
  which the panel prints (`Listing the first 200 command files`) rather than
  silently listing a prefix.

### 6.3 The package-manager question

For a `package` group, the runner is resolved in this order, first hit wins:

1. the file's own `packageManager` field (`bun@1.4.2` → `bun`);
2. the nearest lockfile, walking UP from the file's directory to the scope root —
   `bun.lock`/`bun.lockb` → `bun`, `package-lock.json`/`npm-shrinkwrap.json` →
   `npm`, `yarn.lock` → `yarn`, `pnpm-lock.yaml` → `pnpm`;
3. `bun`.

(1) before (2) because it is the author's explicit statement about that
directory, and a monorepo's root lockfile is a statement about the repo. (3) is
Bun rather than npm because that is what this app's own toolchain is, and a
command runner that guessed `npm run` in a Bun repo would be wrong on the
majority of repos this user opens. The resolved runner is shown on the row
(`bun run dev`), so the guess is visible rather than implied.

### 6.4 The scope, and what is validated

The scope the panel shows is exactly what the kit's repo service reports (§8):
`useRepoScope()` returns `{ root, repo }` — the root resolved from the plugin
context (the active folder's `project_path`), the repo from the shared pick. The
panel does not resolve either itself; it reads the service, so the picker, the
panel and the server call all name one pair. That pair is what every `list` /
`start` / `stop-others` call carries.

`root` and `repo` arrive from the client (the host's own `rootPath` + the shared
repo pick). The plugin's server half validates exactly what it needs and no
more:

- `root` must be absolute, exist, and be a directory;
- `repo` must resolve INSIDE `root` (`path.resolve(root, repo)` +
  `isWithinRoot`-style prefix check) — this is the check that stops
  `repo: '../../etc'`;
- the resolved directory must exist.

**Deliberately not re-implemented: the chamber's root allow-list** (app root, a
path under it, or a registered `project_path`). It needs the chamber's SQLite
file, and F10 says the plugin cannot import `lib/fs/root.ts`. The honest position:
the root is host-supplied (`PanelBodyProps.rootPath` comes from the folder row's
`project_path`), and the plugin's own guarantee is containment. If the full
allow-list is wanted, the right shape is a kit service the host implements
(`resolveScope(path)`), not a second copy of the DB read in the plugin — see
§13, decision D2.

### 6.5 cwd

**cwd is the command file's own directory**, and the argv names only the tool and
the target:

| Kind | argv | Why |
|---|---|---|
| `package` | `[pm, 'run', script]` | `bun run x`, `npm run x`, `yarn run x`, `pnpm run x` all work |
| `make` | `['make', target]` | cwd = the Makefile's directory, so a nested `Makefile` runs its own rules |
| `just` | `['just', recipe]` | cwd = the justfile's directory |
| `task` | `['task', name]` | cwd = the Taskfile's directory |

This is the whole reason grouping by file matters in a monorepo: `make build` in
`packages/api/` is a different command from `make build` at the root, and a
relative path inside the script (`./scripts/gen.sh`) only resolves if the cwd is
the script's own directory.

## 7. Execution

### 7.1 Spawn

`Bun.spawn({ cmd: argv, cwd, stdout: 'pipe', stderr: 'pipe', detached: true,
env: { ...Bun.env } })`. `detached: true` is what creates the process group the
kill uses (F6). A spawn that throws is recorded as `status: 'failed'` with Bun's
message — the same rule the terminal's `describeSpawnFailure` exists for: a
missing `make` must read `Failed to start make: …`, not as an empty row. Measured:
a missing binary THROWS synchronously with `Executable not found in $PATH: "…"`
rather than producing a child with a non-zero exit, so the try/catch around the
spawn is the only path that reports it — a non-zero `exitCode` would be a
different failure (the tool ran and failed).

Output is read incrementally off both pipes into the run's ring buffer (F6 shows
a reader sees the bytes produced before a kill). Exit resolves the run's
`exitCode`/`signal` and publishes.

### 7.2 Stop, and stop-force

`stop` → `process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 1500 ms if the
process is still alive. The escalation is the point: SIGTERM alone lets a
`npm run` that ignores it survive a "stop", and SIGKILL alone gives a tool no
chance to flush its log. `stop-others`, `onDispose` and shutdown go straight to
`SIGKILL` — there is nobody left to read a graceful exit.

`onDispose` kills every run, which is what makes a plugin reload/disable safe;
§10 P0 wires it to the server's shutdown so a restart does not orphan anything
(F4).

### 7.3 The two toggles (per command, not per panel)

**REVISED after the first cut shipped.** The plan put both in the HEADER as the
defaults for the next run, and the implementation did exactly that — then the
requirement changed, correctly: the setting is a property of a COMMAND. `dev`
wants a background job with its log kept, `lint` wants neither, and one pair of
header checkboxes cannot say both. So each row now carries its own two toggles
(icon-only, `aria-pressed`) and the header holds only the scope: which repo, and a
rescan.

They are orthogonal, and each one has exactly one meaning:

- **`output`** — is the run's log OPENED when it starts. On (default): the log
  opens under the row. Off: the row shows status and exit code only, and clicking
  the row opens the log. It changes nothing about the process.
- **`background`** — how the run is TRACKED. Off (default): it is the panel's
  current activity — the row shows a spinner and the result lands in place, which
  is the shape of `bun test`. On: it is a **job** — it is ALSO listed in a
  `Running` section with a Stop button and stays there until it exits or is
  stopped, which is the shape of `bun run dev` (§7.5).

Neither checkbox changes the kill rules: **a repo switch stops both** (§9), and
closing the panel stops neither — a run lives in the server process, so a page
reload does not interrupt a dev server. Both defaults are persisted per session
through the kit's `useSessionState` under the plugin's OWN keys
(`commandRunner.background`, `commandRunner.output`) — the typed session service
carries no namespace (F1b), so the prefix is what keeps a plugin out of the
host's key space.

### 7.4 Caps, and how a refusal is reported

| Cap | Value | On refusal |
|---|---|---|
| concurrent runs | 8 (`settings.maxRuns`) | `start` answers `{ error: 'at_capacity' }` with the count; the panel shows it on the row. Never a silent queue. |
| ring buffer per run | 256 KB | oldest bytes dropped; `bytes` still reports the true total and the view says it is showing the tail (§5.3) |
| log tail served | 64 KB (`settings.logTailKb`) | the view says so |
| command files scanned | 200, depth 4 | `truncated: true`, printed |

### 7.5 The panel, drawn

**REVISED after the first cut shipped** — the sketch below is what the panel
renders now. The version this plan described had two panel-wide checkboxes in the
header, a per-row `bg`/`fg` marker, and a separate `Running` list; the first two
are gone and the row itself is the disclosure.

```
┌──────────────────────────────────────────────────────────────┐
│ [📁 my-workspace ▾]                                  ⟳      │  header: the scope only (§8)
├──────────────────────────────────────────────────────────────┤
│ ▾ package.json                                      2        │  group = the FILE, collapsible
│    ▸ bun run dev        exit 0           [⏱] [▶]              │  row: disclosure + 2 icon
│    ▾ bun run test       running          [⏱] [■]              │  controls, all per command
│      ┌────────────────────────────────────────────────────┐  │
│      │ running · 12s · 48 KB                        Stop  │  │  the row's OWN output
│      │  12 pass · 0 fail                                  │  │
│      └────────────────────────────────────────────────────┘  │
│    ▸ npm run build      exit 0           [⏱] [▶]              │
│                                                              │
│ ▾ packages/web/package.json                         1        │  its own lockfile ⇒ npm
│    ▸ npm run build      —                [⏱] [▶]              │
│                                                              │
│ ▸ Makefile                                          2        │  collapsed: its rows are gone
│                                                              │  (and out of the tab order)
│ ▾ justfile                                          1        │
│    ▸ just lint          has not run yet  [⏱] [▶]              │  disabled disclosure
└──────────────────────────────────────────────────────────────┘
```

The four controls on a row, in order:

| Control | Meaning |
|---|---|
| `▸` / `▾` | The disclosure. Opens THAT command's output under it — DISABLED until the command has run. |
| `[⏱]` | Track this command as a job. Off stops its runs — a toggle that says "not a job" while the job runs is a lie. |
| `[▶]` / `[■]` | Run once / stop. The row opens itself once the run exists. |

**REVISED again, after the output toggle shipped and was removed.** There was a
`[≡]` toggle that kept a command's output open by default. It was one decision
with two controls — expanding the row already shows the output — and a row that
opened itself because a flag was on fought the reader who had just closed it. The
disclosure is now gated on there BEING output, and a live run streams into its own
row. The output is drawn as the chamber's code block (the `.code-block` shell plus
the `Fira Code` 12px/1rem line box), wrapping rather than scrolling sideways.

The runner is part of the row's label (`bun run dev` against `npm run build`), so
the guess §6.3 makes is visible rather than implied — in the sketch above
`packages/web` has its own `package-lock.json`, which is why its row says `npm`
while its siblings say `bun`.

**A background run appears twice on purpose**: its command row keeps its place in
its file group (with its own expansion), and it is also listed under a `RUNNING`
section, which is what survives scrolling — the group list is what a command is
looked up in, the Running section is what is watched. Both draw the same data; the
Running section renders only while at least one run is live.

A row that has never run says so in its own expansion rather than drawing an empty
log, and a killed run reads `stopped (SIGTERM)` — never `exit 0`, which is what a
null exit code would look like.

**The two levels default independently and collapse independently.** A group shows
its rows (absent from `commandRunner.collapsedGroups` means expanded); a row does
NOT show output it was never asked to keep. Collapsing a group leaves its rows in
the DOM but `inert`, so they leave the tab order and the accessibility tree — and
collapsing one group touches no other file's.

## 8. The repo picker, and why it is a kit change

The kit gains FOUR optional services, one hook and one component. Optional
because that is the established shape for an additive service
(`subscribeSessionValue?`, `callRpc?`): an older host must still run a newer kit,
and the hook degrades to "no scope" instead of throwing.

```ts
// packages/ui/src/services.ts
export interface RepoScope { root: string; repo: string; repos: string[]; scanning: boolean; ready: boolean }
// on UiKitServices:
repoScope?(): RepoScope;
setRepoScope?(repo: string): void;
subscribeRepoScope?(listener: () => void): () => void;
/** Force a fresh nested-repo walk for the current root (the picker's ⟳). */
rescanRepoScope?(): void;
```

```ts
// packages/ui/src/repo.ts  (new)
export function useRepoScope(): RepoScope & {
  setRepo(repo: string): void;
  refresh(): void;
};
```

The hook takes NO root argument (unlike the host's own `useRepoScope(rootPath)`).
The ROOT is resolved inside the SERVICE, from the plugin context the host already
publishes (`context().workspacePath` — the same value `usePanelHost().rootPath`
carries), so there is ONE resolution and it serves both callers: the hook in a
panel and the content script, which has no component to call a hook from. The
hook only subscribes and re-reads.

`src/client/lib/plugins/kit.ts` implements them over the SAME two things the four
host panels already share:

- the session slot `workspace.activeRepo` (`REPO_SCOPE_STATE_KEY`), read and
  written RAW — not through the kit's `plugin.`-prefixed session service (F1).
  The stored value is the `{ root, repo }` PAIR the host writes, so `repoScope()`
  must resolve it the way `useRepoScope` does: a pair whose `root` does not match
  the current workspace reports `repo: '.'` rather than another workspace's pick;
- `repoStore` (`src/client/hooks/workspace/repo-scope/store.ts`) for the list and
  the rescan.

Synchronization is then structural rather than a promise: the plugin writes the
one slot every panel reads, and `subscribeSessionKey` is what wakes them — the
same mechanism `useResolvedRepo` uses for the activity bar's dot.

**The subscription must cover a SESSION change as well as a pick change.**
`workspace.activeRepo` lives in per-session state, so switching the active session
changes the effective scope while the stored key is untouched — a subscriber
wired only to `subscribeSessionKey` would keep reporting the previous session's
repo. The host's implementation therefore fires its listener on BOTH
`subscribePluginContext` (the session id) and `subscribeSessionKey`, under one
unsubscribe.

`RepoPicker` (in the kit, `packages/ui/src/repo-picker.tsx`) is the control: a
search field, a refresh that spins while `scanning`, a checkmark on the active
row, and its own outside-click handling (the kit cannot import the host's
`useOnClickOutside`). It draws the rows the SERVICE hands it (`{ repo, label,
short }`), because the naming rule is the host's `repo-label` and the kit cannot
import it — the same rule that made `OptionRow` shared between the two `ask`
shapes. The host's own `repo-picker/index.tsx` becomes a thin wrapper over it in
the same change, so there is ONE picker rather than a plugin copy beside a host
copy, and it keeps only what is host-specific: the modal it opens as the
picker's optional `onManage` row. The git panel's `GitRepoHeader` keeps its own
chrome (branch, fetch, commit count) and is out of scope.

`HOST_CAPABILITIES` gains `'repo-scope'` (F9), so a chamber without the service
refuses the plugin by name instead of rendering a picker that does nothing. Note
the array is `['panel']` TODAY even though `server`, `storage`, `rpc`, `realtime`
and `settings` have all shipped — the file's own comment says a row is appended
when the thing it names lands, and those rows were never appended, so a plugin
declaring any of them is refused today. Backfilling them is a separate, tiny
change; it is recommended (it makes the table honest) but not required here, and
this plugin declares only the capability it actually needs.

Two constraints on the kit component, both verified:

- **The kit has no icon dependency.** `packages/ui/package.json` declares only
  `preact` and `@ompchamber/plugin-sdk`, and no file under `packages/ui/src/`
  imports an icon set. `RepoPicker` therefore draws its chevron, search, refresh
  and check as inline `<svg>` (or text glyphs), exactly as the kit already draws
  every other shape it offers — importing `lucide-preact` would add a dependency
  to a published package for four glyphs.
- **A new kit export needs no shim change.** `introspectExports`
  (`lib/panels/shim.ts`) reads the real module's export list at BUILD time and
  emits a named re-export per name, so a plugin gets `useRepoScope` and
  `RepoPicker` the moment they are exported from `packages/ui/src/index.tsx`.
  The shim list only has to change for a new MODULE (`@ompchamber/ui/<x>`).

Adding a service to `UiKitServices` is a published-contract change, so
`packages/ui` takes a minor version bump in the same change (its release is cut
from commits, so the commit type carries it).

## 9. Force-stop on a repo switch

Three mechanisms, because each one alone has a hole:

1. **The scope watcher, in the plugin's content script.** A content script mounts
   from `PluginBootstrap` for every ENABLED plugin, regardless of which panel is
   shown (F2), and it can reach the kit's services — `uiKitServices()` is
   exported from `@ompchamber/ui` and returns the host's own configured services,
   so a content script reads `repoScope()` / `subscribeRepoScope` directly and
   calls `callRpc(context.pluginId, 'stop-others', …)`. **It must not call the kit
   HOOKS**: `useRepoScope()` needs a Preact component and a content script is not
   one — the plugin id it needs for the RPC comes from its own `mount(context)`
   argument, not from `usePluginId()`. The session id comes from `context()` at
   call time, re-read through the service's own `subscribe` so a session change is
   followed too. Against a host too old to provide `repoScope`, the watcher does
   nothing and mechanism 2 is the net.

   **It does not have to detect a CHANGE.** `stop-others` is defined by the
   scope it is handed (§5.2), so calling it on every notification — and once at
   mount — is idempotent: a run in the current scope survives, a run in any other
   dies. That removes the one piece of state a watcher would otherwise have to
   keep (the previous scope) and the ordering questions that come with it, and it
   makes a missed notification self-healing rather than permanent.
2. **A sweep when the panel mounts.** The panel records the scope it is showing
   and, on mount or on a scope change, calls the same method. This covers a
   chamber that was reloaded (no watcher had run yet) and a phone.
3. **The scope recorded on every run.** `stop-others` kills every run of this
   SESSION whose `scopeKey` differs from the one given — so even a run started
   before a watcher existed is covered by the next one.

Session-scoped rather than global: the repo pick lives in a session's own UI
state, so two sessions legitimately hold two repos, and a run started in session
B must survive a switch in session A. That is a decision, not an accident
(§13 D3).

## 10. Phases

| Phase | Content | Acceptance |
|---|---|---|
| **P0** | Two chamber-side prerequisites. (a) Mount `PluginBootstrap` in the mobile layout with the resolved `activeProjectPath`, so a phone has plugin context and content scripts (F3b). (b) Dispose the plugins before the process exits (F4). The handler must become async and await the disposal BEFORE `process.exit(0)` — today it fires `void app.stop()` and exits on the next line, so an unawaited `disposeAllPlugins()` would never run its disposers. | (a) On a phone-sized viewport, `usePanelInfo()` reports the active session and workspace, and an enabled plugin's content script mounts. (b) With a run in flight, `SIGTERM` on the server leaves no child behind (`ps` by pgid) — and the server still exits promptly, so the fix cannot be "wait for every plugin". |
| **P1** | Kit repo scope: four services, `useRepoScope`, `RepoPicker`, `HOST_CAPABILITIES += 'repo-scope'`, and the host's `repo-picker/index.tsx` switched to the kit component. | Picking a repo in the Files panel moves Source Control's status dot and the Terminal's cwd (existing behaviour, unbroken); the kit picker is what Files renders; a plugin calling `useRepoScope()` sees the same pick and a write reaches the panels. Unit: the service reads/writes `workspace.activeRepo` raw, and `useRepoScope` re-renders on an external write. |
| **P2** | The plugin scaffold: manifest, `marketplace.json` entry, `icon.svg`, `tsconfig.json`, `app.tsx` (a `rightPanel` + a no-op `contentScript`), the panel shell — header (repo picker, two checkboxes, refresh) + explicit empty states. | Install from Settings → Panel Plugins builds both bundles and the activity bar gains `Commands — Runner`. Opening it with no workspace shows a named empty state (never "No session selected" over a live panel — a plugin panel is not workspace-gated, and `enabled: true` does not imply a root, F3); with a workspace it shows the header with the repo picker on it. |
| **P3** | Discovery: the detector table, the bounded walk, PM resolution, the `list` RPC, and the grouped row UI. | A fixture repo with a root `package.json` (a `bun.lock`), `packages/api/package.json` (a `package-lock.json`, one script) and a `Makefile` (`.PHONY`, a variable with a colon, three targets) lists **three groups**, the right runner on each package row, exactly the three make targets, and no `node_modules` path. A file added afterwards appears after Refresh. |
| **P4** | Execution: `start`/`stop`/`stop-others`, the ring buffer, the group kill with escalation, the `/logs` route, the run list and the log view. | Clicking `echo hi` shows `hi`; the row shows exit 0. `sleep 30` in the background appears under `Running` with a live byte count; Stop removes it and the process is gone. A command that does not exist reports `Failed to start …`. The 9th concurrent run is refused with a reason. |
| **P5** | The repo-switch guarantee: the content-script watcher, the mount sweep, scope tagging. | With a background `sleep 60` running and the Commands panel CLOSED, switching repo from the Files panel kills it within one tick (verified by `ps`, and by the run list being empty when Commands is reopened). A run in another session on the same repo survives. |
| **P6** | Docs (`docs/command-runner-plugin.md` finalised, a section in `AGENTS.md`, the plugin's `README.md`), the plugin's unit tests, and `tests/e2e/specs/commands.e2e.ts`. | The e2e spec installs the bundled plugin through the real API, seeds a temp workspace with a `Makefile`, opens the panel, runs a target, and asserts the output on screen and the exit status — then starts a background `sleep` and asserts the repo switch removes it. |

Every phase runs the gates in §11. P0 and P1 are useful on their own (the mobile
plugin context is a bug fix; the shared picker removes a duplication) — neither
depends on the plugin.

**P2 depends on P1**, and not only for the picker: the manifest declares
`capabilities: ["repo-scope"]`, and until that row is in `HOST_CAPABILITIES` the
scan refuses the plugin by name (F9). Installing P2 before P1 therefore fails
with `manifest requires capability "repo-scope" which this chamber does not
provide` — a clear refusal, which is the point of the capability row, but it
means the two cannot be shipped out of order.

**P0(b) has a file-ceiling constraint the other phases do not.** `src/server/index.ts`
is 346 lines — 4 under the limit — so the shutdown change cannot be written
inline. The disposal belongs in a module that already owns plugin lifecycle
(`lib/plugins/loader.server.ts` has `disposeAllPlugins`; the awaited, guarded
wrapper around it — with a timeout so a plugin that hangs cannot block the exit —
goes beside it) and the handler becomes a two-line call. Doing it the obvious way
pushes the file over 350 and fails gate 3.

**P1 likewise touches `packages/ui/src/services.ts` (230) and `kit.ts` (153)** —
both have room, and the `RepoPicker` is a new file, so the ceiling is only a
constraint in `index.ts`.

## 11. Gates

Per phase, from the repo root:

1. `bun run lint` (`tsc --noEmit`)
2. `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`
3. `find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk '$1>350'` — must
   not gain a file. **It prints one today**, pre-existing and unrelated to this
   work: `src/client/hooks/chat/timeline/send.ts` at 357 (measured). Every file
   this plan touches or adds stays under 350.
4. `find marketplace/plugins/command-runner/src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk '$1>350'`
   — the same ceiling inside the plugin. **The repo's own command in gate 3 does
   NOT cover this directory** (`find src` is `src/` only), which is why it is a
   separate line rather than an assumption; the shipped plugins top out at 281
   lines, so the ceiling is the local convention too.
5. `bun run build`
6. `bun test`
7. `bun run test:e2e` for P4–P6 (the browser layer is the only one that sees a
   spawned process and a real panel width)
8. `bun run typecheck:e2e` when the e2e spec lands (P6) — the E2E project is
   typechecked separately because it runs under Node, not Bun.

**The plugin's own `tsconfig.json` is not the gate.** It carries `"types": []`
and `"include": ["src"]`, so `bunx tsc -p marketplace/plugins/command-runner` would
check the plugin in isolation with no Bun globals — useful as a fast local loop,
not as a release gate. The gates above are what must pass, and they cover the
plugin because the ROOT tsconfig includes `marketplace/plugins/*/src` (F11).

## 12. Out of scope

- **Run history.** A restart forgets every run; nothing is written to a table.
- **Editing or adding commands** to `package.json` / `Makefile` from the panel.
  (Commands the USER added are a different thing and are editable — see §5.2.)
- **The full log.** The tail is the view; a run that produces 3 MB says so.
- **A PTY per run.** These are pipes, so a command that expects a terminal
  (progress bars, `git commit`'s editor) will behave differently from the
  Terminal panel's shell. `GIT_TERMINAL_PROMPT=0`-style env discipline is worth
  considering for git-shaped scripts, but no run gets a TTY in this plan.
- **Compose / Docker rows.** SHIPPED — `docker-compose.yml` and its three sibling
  filenames are detector rows, listing two rows per service (`up`, `logs -f`). A
  service is a noun rather than a one-shot command, which is why it gets two rows
  instead of every verb: a list that offers four per service stops being
  scannable.
- **Concurrency beyond the cap**, queueing, and per-run scheduling.

## 13. Decisions to confirm

| | Question | Recommendation |
|---|---|---|
| **D1** | The invisible `contentScript` (F2) is the one piece that reaches past "right panel only". Keep it? | Keep it. Without it, a repo switch made while the panel is closed leaves processes running, which is the requirement. The alternative — making the plugin panel `liveWhileHidden` — does not even work: `WorkspacePanels` returns `null` for an inactive plugin BEFORE it reads that flag, so the flag would have to be honored in two places, and it still fails on a reload and on the phone. |
| **D2** | Should the plugin re-implement the root allow-list, or should the host expose `resolveScope(path)`? | Not in this plan: the root is host-supplied and the plugin enforces containment. Add the kit service if a second plugin needs a validated scope. |
| **D3** | `stop-others` is session-scoped. Should a repo switch stop runs in OTHER sessions on the old repo? | Session-scoped. Two sessions legitimately hold two repos; a global kill would stop a run the user is watching in another tab. |
| **D4** | Defaults: `output` on, `background` off. | Yes — "show me what happened" is the common case, and a dev server is one click away from the job shape. |
| **D5** | The name (`command-runner` / `Runner` / `Commands`). | Changeable in three places; nothing else depends on it. |

## 14. Where this plan was WRONG

Written after the implementation, so the next reader does not repeat them.

1. **`file-explorer/GitRepoDropdown.tsx` does not exist.** It was deleted in
   `09ba6bf` (the commit that added the repo management modal) and this plan
   called it the live picker. The live one is
   `src/client/components/workspace/repo-picker/index.tsx`, which the plan now
   describes.
2. **The kit's `RepoScope` could not carry raw repo paths.** The first version
   sent `repos: string[]` and let the kit derive labels, which is impossible
   across the package boundary — `repo-label` (the rule for what `.` reads as,
   and how a trigger truncates) lives in the host's `shared/lib`. The rows now
   carry `{ repo, label, short }` and the kit is a pure renderer.
3. **The plan's `resolveRunner` reached into the tree without a scope root**, so
   the lockfile walk could climb past the repository. It takes the scope root and
   stops there.
4. **The two checkboxes were drawn on each ROW as well as in the header.** Two
   controls for one value is how a panel disagrees with itself; the row now shows
   a read-only marker.
5. **`start` cannot take `output`.** Whether the log OPENS is the panel's
   business; the server has no opinion and the flag is not in the RPC.
6. **The icon was the `terminal` view's glyph.** A shell prompt (a chevron over a
   line) is exactly what the built-in `Terminal` mark draws, so two buttons in one
   activity bar carried the same mark. It is now Lucide's `square-play`, verified
   distinct by rasterizing both at 32x32 and diffing: **465 of 1024 pixels differ**
   (a shared glyph differs in ~0), with ink 460 vs 119.
7. **The panel-wide checkboxes became per-command toggles, and the rows became
   expandable.** A row is now the git panel's stash shape — `.section-reveal`, a
   full-width disclosure carrying `aria-expanded`/`aria-controls`, the body
   mounted and `inert` while collapsed — with the command's own output inside it.
   Three defects were found building it: a Run that did not open its row (the run
   succeeded and the expansion stayed shut, so the click looked like nothing),
   a Run gated on the old enablement flag (which made a command you do not want to
   WATCH unrunnable), and a `byLabel`-style prefix match in the test that resolved
   the background toggle where it meant the Run control. `Row.test.tsx` pins all
   three, and the open-on-run case fails with the fix reverted.
8. **The output toggle was removed and the disclosure gated on having output.**
   A second revision, after the first one shipped: a `[≡]` toggle decided whether
   a row was open by default, which is the same thing the row's own disclosure
   does — so it went, and the disclosure became DISABLED until the command has run
   (nothing to expand before that, and a control that opens onto a placeholder
   teaches the reader it is unreliable). A live run's output streams into its row:
   verified `FIRST-LINE` at t+1.8s mid-run and `SECOND-LINE` appended by t+5.8s.
   The e2e spec also caught that a disabled control's `title` is not what
   `getByRole(name:)` resolves, which is why the state carries an `aria-label`.
9. **Three bugs the plan did not anticipate, all found by running it:**
   `useRpc`'s `call` in a callback's dependency list loops (the scan re-ran on
   every render — hundreds of requests, and the rows never appeared); the run's
   `sessionId` must be the REAL session or the session-scoped sweep never matches
   it; and `stop` must publish immediately rather than leaving the state to the
   exit handler. Each is pinned by a test now — the `sessionId` one fails
   `commands.e2e.ts` when reverted (verified).

## 15. Verification log


What was actually run for this plan, so each *measured* claim can be re-checked.
Nothing here is implemented.

| Claim | How it was checked |
|---|---|
| F3b — a phone has no plugin context | `grep -rn "PluginBootstrap\|setPluginContext" src/client/components/mobile/` → nothing; only `desktop-layout/index.tsx:237` mounts it. |
| F4 — a restart orphans runs | `grep -rn disposeAllPlugins src` → `loader.server.ts` (the definition) and `routes/panels/panel-routes.test-util.ts` (tests). `src/server/index.ts:339-346` is the signal handler. |
| F5 — `Bun.Glob`'s `ignore` does not exclude `node_modules` | Script under `/tmp/cr-check/`: four `package.json` files (root, `a/`, `a/node_modules/x/`, `b/dist/`); `scanSync` returned all four with `ignore: ['**/node_modules/**']`, with no `ignore`, and with `dot: false`. (The generator must be materialized — a bare `scanSync` result printed as `{}`, which is why the first attempt showed nothing.) |
| F6 — detached group kill, partial output | Script under `/tmp/cr-check/`: `Bun.spawn({ detached: true })` running `echo one; sleep 0.2; echo two; sleep 5; echo three`; `process.kill(-pid, 'SIGKILL')` after 600 ms → `captured: "one\ntwo\n"`, `exitCode: null`, `signalCode: 'SIGKILL'`. |
| F7 — `Bun.YAML` in the server process | `bun -e 'typeof Bun.YAML.parse'` → `function`; parsed a `tasks:` mapping. |
| F10 — `@/…` cannot resolve in a plugin server build | A fixture plugin whose `src/server.ts` imports `@/server/db.server`, built with `Bun.build({ target: 'bun', format: 'esm' })` → `Could not resolve: "@/server/db.server"`. |
| §7.1 — a missing binary throws | `Bun.spawn({ cmd: ['definitely-not-a-real-binary-xyz'] })` → threw `Executable not found in $PATH: "…"`. |
| F9 / F12 / F13 and the capability array | Read from source: `capabilities.ts` is `['panel']`; the built sheet carries `.-top-3` (a stats-only class); `resolve.tsx:255` hardcodes `workspacePath={null}`. |
| F11 — the root tsconfig covers plugin sources | `bunx tsc --noEmit --listFiles` → 29 files under `marketplace/plugins/` in the program, so the plugin is linted without a tsconfig change. |
| F12 — the built sheet carries a plugin-only class | `.-top-3{top:calc(var(--spacing)*-3)}` is in `dist/client/static/js/index-*.css` and `-top-3` appears nowhere under `src/` or `packages/`; its only source is `marketplace/plugins/stats/src/ProcessTable.tsx`. |
| The plugin's own tests run under `bun test` | `bun test marketplace/plugins/stats/src/format.test.ts` → 8 pass. |
| The line ceiling | `find src -name "*.ts" -o -name "*.tsx" \| xargs wc -l \| awk '$1>350'` → `src/client/hooks/chat/timeline/send.ts` (357) only, pre-existing. |

Not verified here, and named as such in the plan: the assembled browser path (P4
onward), which needs the plugin to exist.
