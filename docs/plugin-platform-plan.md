# Plugin platform plan

Bring the chamber's panel-plugin surface up to the shape `get-bb/bb` ships, so a
plugin can do more than draw a view: own server-side state, contribute to more
than four places, and be tested without the chamber running.

Status: **P0–P5 complete**; P6 deliberately not done (see below). The phase
table at the bottom records what each phase verified.

Reference implementation: `github.com/get-bb/bb` @ `main`, `packages/plugin-sdk`
(`@get-bb/plugin-sdk` 0.6.33). Every claim about bb below is read from that
tree; every claim about the chamber is read from this one.

## Why

Today a chamber plugin is **view-only**: one ESM bundle the host `import()`s into
the page, registering at most one component into each of four slots
(`rightPanel`, `panel`, `headerPanel`, `settingsSection`). It has no server
half, no storage, no route, no test harness, and no CLI. bb's SDK is a plugin
*platform*: a `server.ts` factory receiving a ~25-member API (`storage`, `rpc`,
`http`, `realtime`, `background`, `cli`, `agents`, `events`, `settings`,
`onDispose`), an app half with ~25 slots, a two-sided test harness, and a
`bb plugin new|build|types` CLI.

The gap is not one feature. It is a whole axis — the server half — plus the
tooling that makes an ecosystem possible.

## Gap analysis (measured)

| Axis | Chamber today | bb |
|---|---|---|
| Contract size | 214 LOC (`packages/plugin-sdk/src/{index,app}.ts`) | ~5,600 LOC of contract alone (`app-contract.ts` 3,495 + `backend-contract.ts` 2,148 + `cli-spec.ts` 41 KB + `rpc-contract.ts` + `host-contract.ts` + `vendor-plugin-roots.ts` 24 KB + `provider-bridge.ts` 15 KB) |
| Halves | Frontend only | `server.ts` (`BbPluginApi`) **and** `app.tsx` (`PluginSdkApp`) |
| Framework | Preact (`preact`, `preact/hooks`, `preact/compat`), zero React | React 19 (peer) |
| Slots | 4 | ~25: `homepageSection`, `navPanel`, `threadPanelAction`, `pendingInteraction`, `sidebarFooterAction`, `threadList`, `threadHeaderAction`, `browserToolbarAction`, `fileOpener`, `sourceCodeRenderer`, `diffRenderer`, `messageDirective`, `messageAction`, `commandPaletteAction`, `providerIcon`, `timelineRenderer`, `environmentProviderInputs`, `machineProviderInputs`, `composer.customize`, … |
| Registration | At most one per slot; a second `throws` (`PluginApp` in `app.ts`) | Keyed multi-registration; `register(...)` returns a disposer |
| Server API | none | `settings`, `storage` (KV + per-plugin SQLite), `http` (Hono), `rpc` (Standard Schema), `realtime`, `background` (services + cron), `cli`, `agents`, `providers`, `events`, `experimental_hooks`, `experimental_environments`/`machines`, `sdk`, `status`, `server`, `hosts`, `onDispose` |
| Runtime global | `__ompchamberPluginRuntime` = `{ preact, hooks, jsxRuntime, jsxDevRuntime, compat, sdkApp, ui, uiComponents }` | `__bbPluginRuntime` = `{ pluginSdkApp, react }` |
| Manifest | `ompchamber` key: `id, name, version, description, homepage, app, icon, readme, branding` | `bb` key: `name, description, branding.icon, server, app` + `engines.bb`, `engines.bbPluginSdk` |
| Build | `build.server.ts` (bun install + shimmed `Bun.build`) | `bb plugin build` (esbuild + rollup-dts), `bundled-types/`, `bb plugin new`, `bb plugin types` |
| Test harness | none shipped | `@get-bb/plugin-sdk/testing` (`createFakePluginHost`, fixtures) + `/testing/app` (`loadPluginApp`, `renderSlot`, `mountPluginContentScripts`) |
| Deps | 0 (SDK); `preact` (ui) | runtime `cross-spawn`, `zod`; optional peers `hono`, `better-sqlite3`, `react`, … |
| Subpaths | `.`, `./app` | `.`, `./app`, `./host`, `./provider-bridge(/acp)`, `./environment-provider`, `./machine-provider`, `./testing(/app|/host)`, `./internal/*` |
| Ecosystem | 1 bundled example (`marketplace/plugins/session-info`, no test file) + git install | 41 bundled plugins (`packages/bundled-plugins`), `plugins/bb-official.json`, component registry, "forkable plugin" rule |

## Decisions

**D1 — Build the server half; skip the agent-platform half.**
`storage`, `settings`, `rpc`, `http`, `realtime`, `background`, `events`, `cli`,
`onDispose` are in scope: they are what a *view console for omp* needs from a
plugin. `providers`, `experimental_environments`, `experimental_machines`,
`provider-bridge`, `machine-provider` are **out of scope, permanently**: those
exist because bb ships its own agent runtime and lets a plugin supply it. The
chamber's agent is omp, reached over RPC; a plugin does not get to replace it.

**D2 — Plugin server code runs in-process, like bb, and that is a trust
decision stated in the docs.** A plugin is local code the user installed from a
git URL or from the bundled marketplace, trusted the way a VS Code extension is
trusted — which is already true of its bundle, which runs in the page with full
DOM and `fetch` access to every chamber API. A worker or child-process boundary
would buy isolation bb does not have, and would break the API shape: bb binds a
plugin's SDK client on the host's own loopback, and the chamber would have to do
the same. Rejected: sandboxing.
What we DO add is the enforcement bb has and we lack: a plugin's storage, routes
and RPC methods are all **namespaced by plugin id**, so one plugin cannot read
or overwrite another's state by accident.

**D3 — Preact stays.** bb is React 19. Rewriting our component layer to React to
match a reference implementation would trade our whole client (zero React
packages, enforced by rule 4b of `AGENTS.md`) for parity we do not need. A
plugin author writing for the chamber writes Preact; `@ompchamber/ui` and the
runtime shim already make that seamless.

**D4 — The manifest key stays `ompchamber`, and gains `engines`.** Not a
cosmetic difference: our scan, catalog and pane all read `ompchamber`, and
renaming it would be a breaking manifest change for zero benefit. What we copy
from bb is the *content* of the field — `engines.ompchamber` and
`engines.pluginSdk` — because an incompatible plugin that loads and misbehaves is
worse than one that is refused by name.

**D5 — One extension point stays ONE registration; only the new ones are keyed
multi.** `rightPanel`/`panel`/`headerPanel` are positions the layout has exactly
one of, so bb's keyed multi-registration buys nothing there and would make
`plugin:<id>` stop being a unique panel key. Every NEW slot (message action,
command palette, file opener, …) is keyed and returns a disposer, because those
are lists.

**D6 — The SDK gains a test harness before it gains a server half.** P0 is
independent of P2–P6, needs no contract change, and is the single highest-value
item for a plugin author: today a plugin's tests must hand-mock
`globalThis.__ompchamberPluginRuntime`.

## Phases

| Phase | Content | Gate |
|---|---|---|
| P0 ✅ | `@ompchamber/plugin-sdk/testing` + `/testing/app`: `createFakeChamberHost`, `loadPluginApp`, `renderSlot`, `renderPanel`, `installTestPluginRuntime`, fixtures | **Done.** `packages/plugin-sdk/src/testing/` + a real test for `marketplace/plugins/session-info`. The four load-bearing properties are pinned: no eager runtime read (a harness built with the global deleted works), the kit wired through the SAME `configureUiKit` the host calls, `renderSlot` self-installing both halves, and the registrar's four validation rules with the host's exact strings. |
| P1 ✅ | Manifest `engines` (`ompchamber`, `pluginSdk`) + `capabilities`; refusal with a reason | **Done.** `satisfiesRange`/`isValidRange` added to the existing `shared/lib/updates/semver.ts` (no second implementation); `HOST_CAPABILITIES = ['panel']` — only what ships. A refused plugin names BOTH sides and is absent from `panels`/`dirs`; absent `engines` still passes, so every existing plugin keeps working. |
| P2 ✅ | Backend entry: `server.ts` factory, `ChamberPluginApi` with `storage`, `settings`, `rpc`, `http`, `realtime`, `events`, `background`, `onDispose`; namespacing enforced server-side | **Done.** Verified on a REAL plugin: built (two targets), loaded through the registry, its RPC method answered over the route's own path, its HTTP route answered a real `Request`, its topic moved on a write, and disposal took every registration back. Namespacing is a property of the call signature — the host binds `plugin_id` from the id it was handed, so a plugin never holds a string it could point at another's rows. |
| P3 ✅ | Slots: `messageAction`, `commandPaletteAction`, `fileOpener`, `sourceCodeRenderer`, `diffRenderer`, `timelineRenderer`, `composerAction`, `composerBanner` | **Done.** Each attached to an existing surface, and each renders NOTHING when no plugin contributed — pinned per slot, so a chamber with zero plugins is behaviourally identical (e.g. the run footer still has exactly its 3 built-in buttons; the editor still falls through to `FileDocument`; the tool card still runs `ToolDetailsPanel`). |
| P4 ✅ | Keyed multi-registration with disposers; a duplicate key refused | **Done.** `registerListSlot` returns the disposer for exactly its own row; a duplicate `id` throws naming the slot and id; rows merge ACROSS plugins sorted by `order` then pluginId then id (a total order, so two plugins at the same `order` still render deterministically). A rebuilt bundle clears its own rows first, so it cannot collide with itself. |
| P5 ✅ | `ompchamber plugin new\|build\|types\|list` + `bundled-types/` | **Done.** `new` emits declarations AND the `paths` mapping onto them, so a fresh directory typechecks on the first run (verified against a scaffold in a temp dir). `build` is the CLI's own entry to the same `buildPanelPlugin` the server runs. `types` excludes the packages' own suites — they import `bun:test`, which a plugin's tsconfig does not resolve. |
| P6 ❌ | Component registry + forkable-plugin rule | **Deliberately not done** — see below. |

Every phase must pass: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals
--noUnusedParameters`, the 350-line check
(`find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk '$1>350'`),
`bun run build`, and `bun test`.

## P0 — Test harness

The harness is a **published** package half, so it must not import chamber
source: it is a second implementation of the runtime contract, driven by the
same types the host uses.

New files:

- `packages/plugin-sdk/src/testing/index.ts` — `createFakeChamberHost(options)`
  returning `{ host, harness }`. `harness` splits into `behavior` (deterministic
  inputs: rpc/http/events/settings), `inspection` (recorded registrations and
  calls) and `lifecycle` (`reload`, `dispose`), mirroring bb's split so a plugin
  author's muscle memory transfers.
- `packages/plugin-sdk/src/testing/app.tsx` — `installTestPluginRuntime()`,
  `loadPluginApp(module)`, `renderSlot(registration, props, overrides)`.
- `packages/plugin-sdk/src/testing/fixtures.ts` — `makePanelContext`,
  `makeSessionValueStore`, `makeChamberFetchResponse`.

Load-bearing properties, each of which is a bug if missed:

1. **`loadPluginApp` must not require an installed runtime first.** bb's
   forwarders look the runtime up when they are CALLED, not when the module
   loads, so a plugin's `app.tsx` can be imported before the harness installs
   one. Our `pluginRuntime()` already throws at call time and `definePluginApp`
   needs no runtime at all, so this property holds today and the harness must
   preserve it rather than import the runtime eagerly.
2. **The kit is wired through `configureUiKit`, not the global.** `@ompchamber/ui`
   reads its services from a module-level slot (`packages/ui/src/services.ts`)
   and `requireServices()` throws without them — so the harness installs a fake
   set through the SAME public function the host calls. That is the whole seam,
   and a harness that mocked the global instead would test nothing the host does.
3. **`renderSlot` installs both halves itself.** A test that renders a plugin
   component without calling `installTestPluginRuntime()` must not fail with a
   confusing "runtime unavailable".
4. **The fake host validates registrations the way the real one does** —
   duplicate `id`, unknown slot, a component that is not a function — so a test
   catches what the host would refuse.

Changed files:

- `packages/plugin-sdk/package.json` — the `./testing` and `./testing/app`
  subpaths, plus `happy-dom` as an optional peer for the app half.
- `tsconfig.json` — a `paths` entry per new subpath. The file already lists
  every SDK/kit subpath explicitly (`@ompchamber/plugin-sdk/app`,
  `@ompchamber/ui`, `@ompchamber/ui/components`), so a new subpath that is not
  added there typechecks as an unresolved import.
- `release/packages.js` is untouched: the tag prefix is per package, not per
  subpath.

The chamber's own build is untouched — the harness is only ever imported by a
plugin's tests — and the root `tsconfig.json` already includes
`marketplace/plugins/*/src`, so the example plugin's new test file is covered by
`bun run lint` without another change.

## P1 — Manifest engines and capabilities

`src/shared/types/panels.ts` gains, on `PanelPluginManifest`:

```ts
/** Host versions this plugin declares it works with. */
engines?: { ompchamber?: string; pluginSdk?: string };
/** Capabilities the host must provide; a missing one refuses the plugin. */
capabilities?: string[];
```

`src/server/lib/panels/manifest.ts` validates the ranges (same `ID_RE`-style
strictness: a range that is not a range is a refusal, not a pass), and
`registry.server.ts` refuses an incompatible plugin into `scan.errors` with a
reason naming the required and the running version — the pane already renders
`errors` with their reason, so this is a validation addition rather than a new
surface.

The comparison must use the SAME semver rule the host's own version check uses
(`compareVersions` / `isNewer` / `normalizeVersion` in
`src/shared/lib/updates/semver.ts`, the module `updates/omp.ts` and
`updates/install.ts` already read), not a second implementation. A range
grammar (`^1.2`, `>=1`) is therefore a new function in that shared module, not
a dependency.

## P2 — Backend entry

The largest phase, and the one that changes what a plugin IS.

**Manifest.** `app` becomes optional and `server` is added — a plugin may be
server-only (a background job with no UI), UI-only (today's shape), or both. At
least one must be present; neither is a refusal.

**Contract.** `packages/plugin-sdk/src/backend.ts` (published) defines
`ChamberPluginApi`, and `packages/plugin-sdk/src/index.ts` re-exports it. The
members, and what each maps onto in this repo:

| Member | Chamber implementation |
|---|---|
| `pluginId`, `log` | From the registry; a leveled logger prefixed with the id |
| `storage.kv` | A `plugin_kv` table keyed `(plugin_id, key)`, value JSON |
| `storage.db` | A `plugin_<id>` table created on first use, or a single `plugin_records` table keyed by plugin id — **decide by measurement**, not preference: the per-plugin table is bb's shape and gives real indexes, the shared table is one migration |
| `settings` | Declarative schema in the manifest; values in `plugin_settings`, editable from the plugin's own settings section |
| `rpc` | Methods under `/api/plugins/<id>/rpc/<method>`, validated with the same Standard Schema subset bb uses (Zod 4 implements it directly — **this is the one new runtime dependency the SDK would take**, and the decision to take it or hand-roll a validator is a P2 spike) |
| `http` | Routes under `/api/plugins/<id>/http/*`. Elysia is already the router, so a plugin route is mounted as a `HandlerBinding` from `bindingsFor`, not as a Hono app |
| `realtime` | A topic family `plugin:<id>` on the existing hub — `subscribe`/`publish` through `getRealtimeHub()`, which already does refcounting, coalescing and snapshot-then-delta |
| `events` | Lifecycle announcements the chamber already has (`session-attached`, `stream-status`, `panels-changed`), published through the server signal bus (`src/server/lib/realtime/signals.server.ts`) and reaching the client on the hub |
| `background` | Long-lived services and cron schedules. **Reuse `src/server/lib/schedule/`** rather than inventing a second scheduler: `claimDueTasks` is already claim-safe across instances, and a plugin's schedule is a row with an owner column |
| `onDispose` | LIFO cleanup on reload, disable and remove. There is no disposal path for a panel plugin today — its bundle is imported once and never unloaded — so this is a new lifecycle owned by the new server-side loader |

**Loader.** `src/server/lib/plugins/` (new, beside `panels/`): discovery, load,
namespace enforcement, disposal. A plugin's `server.ts` is imported by the
SERVER, so it must be built for Bun (`target: 'bun'`), not for the browser —
which means `build.server.ts` grows a second build step keyed on whether the
manifest names a `server` entry.

**Invariants, each of which is a bug if missed:**

1. **Namespacing is enforced at the API boundary, never by convention.** Every
   storage call, route and RPC method is registered under the plugin's own id;
   a plugin cannot name another's namespace because it is never given the
   string.
2. **A plugin that throws on load is reported, not skipped.** Same rule the
   bundle loader already follows: silence reads as "this plugin does nothing".
3. **Disposal is exact-once and LIFO.** A reload that runs a plugin's disposer
   twice (or zero times) leaks a timer or a subscription. Pinned by a test that
   reloads under a live registration.
4. **A server-only plugin has no bundle URL**, and the registry payload must
   not advertise one — a card that offers a panel for a plugin that draws
   nothing is a dead button.

## P3 — Slots

Each slot is a versioned contract, additive within an SDK major. What shipped,
and the surface each attaches to:

| Slot | Surface | Registration |
|---|---|---|
| `messageAction` | A chat row's action strip (desktop cluster AND the phone's sheet), and the user row's own cluster | `{ id, title?, order?, component }` |
| `commandPaletteAction` | The composer's `/` popup, merged with `CHAMBER_COMMANDS` | `{ id, title?, order?, command, description, hint?, run }` |
| `fileOpener` | The editor, replacing the file view when `matches` accepts it | `{ id, title?, order?, matches, component }` |
| `sourceCodeRenderer` | The editor's read-only code view, by claimed extension | `{ id, title?, order?, extensions, component }` |
| `diffRenderer` | The diff viewer | `{ id, title?, order?, extensions?, component }` |
| `timelineRenderer` | A tool-call card, matched by tool name exactly | `{ id, title?, order?, tool, component }` |
| `composerAction` | The composer toolbar's right cluster | `{ id, title?, order?, component }` |
| `composerBanner` | A strip above the composer's input | `{ id, title?, order?, component }` |

`navPanel` was dropped: the chamber's right-panel catalog already merges
built-ins and plugins through one resolver (`usePanelCatalog`), so a plugin's
panel is already an activity-bar entry — a `navPanel` slot would have been a
second way to say `rightPanel`. `composer.customize` became the two concrete
slots (`composerAction`, `composerBanner`), which is what the reference
implementation actually uses.

**The acceptance property is per-slot and pinned per-slot:** a surface renders
NOTHING when no plugin contributed, so a chamber with zero plugins is
behaviourally identical — the run footer still has exactly its three built-in
buttons, the editor still falls through to `FileDocument`, the tool card still
runs `ToolDetailsPanel`, and the popup pool is the same commands in the same
order.

## P4 — Keyed multi-registration

`PluginListSlots` methods take a keyed registration and return the disposer for
exactly that row (`registerListSlot`). Three rules, all enforced:

1. **A duplicate `id` within one plugin and slot THROWS**, naming the slot and
   the id. The registration the plugin made first is the one it can address; a
   quiet replace would leave a component the host draws while the plugin
   believes it registered something else.
2. **Rows merge ACROSS plugins**, sorted by `order` (absent = 0) then plugin id
   then registration id — a TOTAL order, so two plugins contributing at the same
   `order` still render deterministically across reloads rather than following
   map insertion.
3. **A rebuilt bundle clears its own rows first** (`clearPluginListSlots` at the
   top of `registerPluginBundle`), because a bundle re-imported under a new URL
   registers again and would otherwise collide with its own ids.

The store is a different SHAPE from the positional one, and that is the design:
a positional slot resolves PER PLUGIN (`rightPanelOf(slots)`) because the layout
draws one plugin's panel at a time, while a list slot resolves ACROSS plugins
because an action strip shows everyone's rows.

## P5 — CLI and declarations

`src/cli/lib/commands/plugin.js` adds `ompchamber plugin new|build|types|list`:

- **`new <dir>`** scaffolds a plugin directory — manifest, `src/app.tsx`,
  `src/server.ts`, `tsconfig.json` — and writes its `bundled-types/` immediately.
  The `tsconfig.json` maps `@ompchamber/plugin-sdk`, `/app`, `/testing`,
  `/testing/app`, `@ompchamber/ui` and `/components` onto those declarations, so
  a fresh directory typechecks on the first run with NO chamber source on disk.
  `baseUrl` is deliberately not set: TypeScript 7 deprecates it, and `paths`
  resolves relative to the tsconfig without it.
- **`build <dir>`** is the CLI's own entry to the same `buildPanelPlugin` the
  server runs, so a plugin author builds exactly what the chamber will build.
- **`types <dir>`** (re)emits `bundled-types/`. It COPIES the packages' sources
  rather than compiling them — the sources ARE the declarations for a consumer
  that only imports types, and the plugin's own `tsc` reads them directly. The
  packages' own `*.test.ts` files are excluded: they import `bun:test`, which a
  plugin's tsconfig does not resolve, so copying them would fail every plugin's
  typecheck on a file it never asked for.
- **`list`** reports the installed plugins and their build state, through the
  same `discoverPanelPlugins` the pane reads.

**`dev` was not built.** The server already re-scans on `panels-changed` and
`buildPanelPlugin` is fast (~25 ms for the example), so the missing piece is a
watcher over the plugin's `src/`, not a new build path. `ompchamber plugin
build .` after an edit, plus the pane's Rebuild, covers the same ground; a
watcher is worth adding when someone is editing a plugin continuously enough to
notice.

Two `resolvePath` bugs surfaced through this command and were fixed in
`src/cli/lib/path-utils.js`: an absolute segment used to be JOINED rather than
honoured (`plugin new /tmp/x` scaffolded into `<cwd>/tmp/x`), and `.` used to
survive into the result (`<cwd>/.` instead of `<cwd>`).

## P6 — Component registry and forkable plugins

**Not done, and the decision is recorded rather than left implicit.**

bb's registry (`packages/plugin-registry/registry.json`, `npx shadcn add
@bb/<name>`) exists because bb REMOVED its UI kit: plugins vendor component
source instead of importing a kit, so the registry is the delivery mechanism for
components that no longer have a package.

The chamber ships a kit (`@ompchamber/ui`) and it is the seam P0 already depends
on — `configureUiKit` is how the harness wires a fake, and how the host wires the
real one. P3 added eight new surfaces and NONE of them needed a component the kit
does not have: every slot's contribution is the plugin's own markup, rendered in
the host's tree with the host's theme classes. That is the evidence the phase
existed to wait for, and it says the kit's surface is not the constraint.

What bb's registry genuinely buys is **component breadth** (Radix primitives,
tables, charts) for plugins that want a rich UI. A plugin that wants those can
depend on the library directly — it is a Preact-native world, so `lucide-preact`
or a hand-rolled primitive is the same work either way, and the chamber does not
have to own a generated registry to make that possible.

**Revisit if:** a real plugin needs a component whose implementation is large and
host-coupled (a virtualized table reading the chamber's session store, say). Then
the answer is a new module in `@ompchamber/ui`, not a registry.

## Deliberate divergences (do not "fix")

| We keep | Because |
|---|---|
| Preact, zero React | Rule 4b; the whole client is Preact and the runtime shim hands one instance to every plugin |
| `ompchamber` manifest key | Our scan, catalog and pane read it; renaming is a breaking change for no gain |
| One registration for the three positional slots | The layout has one of each; `plugin:<id>` is a unique panel key that a second registration would break |
| No provider/environment/machine plugin APIs | bb ships an agent runtime; the chamber's agent is omp |
| `no-store` on the bundle route + content-hash URL | Already correct, and the reason a rebuilt plugin reloads |

## Open questions — resolved

1. **Zod as a runtime dependency, or a hand-rolled Standard Schema subset?**
   **Neither, and the SDK stays at zero runtime dependencies.** The contract
   declares the Standard Schema *interface* (`~standard.validate`), which Zod 4,
   Valibot and ArkType all satisfy — so a plugin brings its own validator or
   writes a plain object, and the chamber validates through the shape. Verified
   in the example plugin's own `save` method, whose schema is 12 lines with no
   dependency, and in `platform.test.ts`'s input/output suites. The
   interface is deliberately NOT generic over its output: a registry stores
   methods of every schema type together, and a covariant parameter makes that
   storage unsound.
2. **Per-plugin SQLite table vs one shared `plugin_records` table.** **Shared,
   one table per axis** (`plugin_kv`, `plugin_records`, `plugin_settings`), each
   keyed by `plugin_id` first. A plugin-declared schema would mean DDL driven by
   a third-party manifest — a migration the chamber cannot version, and a table
   namespace two plugins could collide in. `(plugin_id, collection, id)` gives
   the same expressiveness with one migration, and the composite key IS the
   index. A plugin's `list` is clamped to 1000 rows, so one plugin cannot block
   the synchronous driver for every other request.
3. **Does the server half need `http` at all, given the realtime hub?** **Yes,
   and P3 showed why.** A topic carries a VALUE to the chamber's own client; an
   HTTP route is what anything ELSE reaches — a webhook receiver, a shareable
   URL, a stream. They are different callers, not two ways to do one thing. The
   surface is one wildcard binding with a map lookup inside it, so a plugin that
   registers a route after the server is listening is reachable immediately
   (Elysia's routing table is built at boot, so per-plugin routes would have
   needed a restart).
