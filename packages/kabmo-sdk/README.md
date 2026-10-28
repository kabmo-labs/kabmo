# @kabmo-labs/kabmo-sdk

The contract between a Kabmo panel plugin and the Kabmo host: what a plugin's
browser bundle exports, what its `server.ts` receives, and a fake host so a
plugin can be tested with no Kabmo process, no database and no network.

Type-only except for a handful of helpers, so importing it costs a plugin
bundle almost nothing.

The package ships its TypeScript **source** (`files: ["src"]`, every export
pointing at a `.ts` file) and has no build step of its own — a plugin's own
`tsc` and Bun's bundler read it directly.

## Install

Kabmo links this package into a plugin's `node_modules` before building, so a
plugin never has to resolve it from a registry that may not carry it. Declare it
as an **optional peer** — that is the only form that installs cleanly when the
package is absent:

```json
{
  "peerDependencies": {
    "@kabmo-labs/kabmo-sdk": "*",
    "@kabmo-labs/kabmo-ui": "*",
    "preact": "^10.29.8"
  },
  "peerDependenciesMeta": {
    "@kabmo-labs/kabmo-sdk": { "optional": true },
    "@kabmo-labs/kabmo-ui": { "optional": true },
    "preact": { "optional": true }
  }
}
```

`preact` is provided by the host as well. Do not declare it as a real
dependency — the build shims it to the host's instance, and a second copy is a
component tree the host cannot render.

Scaffold a plugin — manifest, `src/app.tsx`, `src/server.ts`, `tsconfig.json`
and the SDK's declarations — with `kabmo plugin new <dir>`. `kabmo plugin build`
runs the same build Kabmo runs on install, and `kabmo plugin types` re-emits the
declarations so the directory typechecks with no Kabmo source on disk.

## Subpaths

| Import | What it is |
|---|---|
| `@kabmo-labs/kabmo-sdk` | Everything: the app contract, the server contract, `env`, `scope`, and the slot types. |
| `@kabmo-labs/kabmo-sdk/app` | The app contract alone. This is the specifier the build marks external and rewrites to `globalThis.__kabmoPluginRuntime.sdkApp`. |
| `@kabmo-labs/kabmo-sdk/testing` | The fake host, fixtures and the fake sidebar. No DOM. |
| `@kabmo-labs/kabmo-sdk/testing/app` | `loadPluginApp` / `renderSlot` / `renderPanel`, for rendering a plugin's components. Needs a DOM. |

The pre-rename package names (`@kabmo-labs/plugin-sdk/app`,
`@ompchamber/plugin-sdk/app`) are not published by this package, but the host's
runtime shim still maps them to the same slot — a bundle already built against
them keeps loading. Write the current names in new code.

## The app half

A plugin's browser entry exports one definition:

```tsx
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';

export default definePluginApp((app) => {
  app.rightPanel({ id: 'info', title: 'Session Info', component: SessionInfo });
});
```

`definePluginApp` exists so the host has one validated shape to look for, and so
exporting the setup function directly fails loudly instead of loading and doing
nothing. `isPluginAppDefinition` is the check the host applies.

### Positional slots — one registration each

| Method | Where it renders | Props |
|---|---|---|
| `app.rightPanel({ id, title?, component, minWidth?, defaultFraction? })` | The right panel's body, behind an activity-bar button. | `{ sessionId, workspacePath }` |
| `app.panel({ … })` | The editor column, taken over whole — no tabs, no file tree, no chrome. | `{ sessionId, workspacePath }` |
| `app.headerPanel({ id, title?, component, dropdown?, opensPanel? })` | The navbar, on both layouts. Without `dropdown` or `opensPanel` the trigger is inert text, not a button. | `{ sessionId, workspacePath }` |
| `app.settingsSection({ id, title?, component })` | A block in Settings → Panel Plugins. | `{ pluginId }` |

A second registration for the same positional slot **throws**: the layout gives
a plugin one button, one navbar entry and one column, so a second one would be
unreachable and a quiet overwrite would hide a broken plugin.

**`opensPanel` turns a header trigger into an action.** It names a SLOT
(`'rightPanel'` or `'panel'`), and the host opens that registration's panel
**wherever the user placed it** — the left dock, the right column, the editor
column, or the phone drawer that holds it. A plugin never names a column, so a
user who moved the panel does not break the readout. It cannot be combined with
`dropdown` (one click opens one thing), and naming a panel the plugin did not
register is refused at registration:

```tsx
app.rightPanel({ id: 'stats', title: 'Resources', component: StatsPanel });
app.headerPanel({ id: 'resources', title: 'Stats', component: StatsReadout, opensPanel: 'rightPanel' });
```

On a phone too narrow to hold the entry beside the session title, an
`opensPanel` trigger moves into the header's `⋯` menu — the same action, one
click away — rather than shrinking or being dropped. A `dropdown` or a static
readout never folds: the first needs its trigger's anchor, the second has no
action to move.

`minWidth` (px, never below 320) and `defaultFraction` (clamped to 0.2–0.9)
size a panel. Absent means the host's default.

### List slots — rows among rows

Each takes a keyed registration and **returns the disposer** for exactly that
row. A duplicate `id` within the same plugin and slot throws; `order` sorts
within the slot (lower first, ties by plugin id then registration id).

| Method | What it contributes |
|---|---|
| `messageAction({ id, title?, order?, component })` | A button in a chat row's action strip. Props: `{ sessionId, workspacePath, messageId, role, text }`. |
| `commandPaletteAction({ id, title?, order?, command, description, hint?, run })` | A row in the composer's `/` popup. `run({ sessionId, workspacePath, args })`. |
| `fileOpener({ id, title?, order?, matches, component })` | Replaces the editor's file view when `matches({ path, extension })` accepts it. |
| `sourceCodeRenderer({ id, title?, order?, extensions, component })` | Replaces the read-only code view for the extensions it claims. |
| `diffRenderer({ id, title?, order?, extensions?, component })` | Replaces the diff viewer. |
| `timelineRenderer({ id, title?, order?, tool, component })` | Draws a tool call the host has no panel for. `tool` matches exactly; the first row in `order` wins, so a plugin never shadows the host's own `bash`/`read` cards. |
| `composerAction({ id, title?, order?, component })` | A button in the composer's toolbar. |
| `composerBanner({ id, title?, order?, component })` | A strip above the composer's input. |
| `pendingInteraction({ id, title?, order?, component })` | Renders the agent's own question and may answer it. |
| `messageDirective({ id, title?, order?, name, component })` | Claims a fenced block (`omp:chart`) in an assistant message. The one slot whose `id` must be unique **across plugins** (`GLOBALLY_KEYED_SLOTS`); a fence `name` resolves to the first row in `order`. |
| `contentScript({ id, title?, order?, mount })` | Mounts code into the app shell with no component. `mount(ctx)` must return a disposer. |
| `experimental_providerIcon({ id, title?, order?, provider, glyph })` | A provider's mark as SVG source, painted `currentColor`. |

`LIST_SLOT_NAMES` is the slot keys as data, and `GLOBALLY_KEYED_SLOTS` names the
one slot whose registration `id` must be unique across plugins
(`messageDirective`) rather than only within one.

**`experimental_` is a contract, not decoration.** It marks a surface whose
shape may move between minor versions. The stable participants are `useRpc`,
`useRealtime` and `useComposer`; the sidebar hooks and the provider-icon
registration carry the marker.

### Runtime global

A plugin bundle does not carry Preact, the kit or this SDK. The build marks each
shared specifier external and rewrites it to read
`globalThis.__kabmoPluginRuntime` (`PLUGIN_RUNTIME_GLOBAL`), which the host
publishes before any bundle loads. `pluginRuntime()` reads it and throws naming
the real problem when a bundle is loaded outside Kabmo.

## The server half

A plugin may ship `src/server.ts`, built to `dist/server.js` and imported into
Kabmo's own process. Its default export is a factory:

```ts
import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

export default function plugin(api: KabmoPluginApi) {
  api.rpc.register('list', { handler: async () => api.storage.records.list('items') });
  api.http.route('/status', () => Response.json({ ok: true }));
  api.realtime.publish({ count: 3 });
  api.onDispose(() => api.log.info('disposed'));
}
```

| Member | What it gives you |
|---|---|
| `pluginId` | The plugin's own id. Namespaces every other member. |
| `log` | `debug` / `info` / `warn` / `error`, prefixed with the plugin id. |
| `storage.kv` | `read` / `write` / `remove` / `keys`, namespaced by plugin id. |
| `storage.records` | `put` / `get` / `list` / `remove` / `clear` — rows with an id, per collection. |
| `settings` | `read` / `readOne` / `write` / `subscribe`, against the manifest's declared settings. |
| `rpc` | `register(method, { input?, output?, handler })`. Called by the plugin's own client half at `POST /api/plugins/<id>/rpc/<method>`. |
| `http` | `route(path, request => Response)`, under `/api/plugins/<id>/http/*`. Paths match exactly. |
| `realtime` | `publish` / `current` / `seed` on the plugin's own `plugin:<id>` topic. |
| `events` | `on(name, listener)` and `emit(name, payload)` between plugins and the client. |
| `background` | `service(id, { start, stop? })` and `schedule(id, spec, run)`. Declared, never run by the plugin. |
| `onDispose` | Cleanup on reload, disable and removal — LIFO, exactly once per registration. |

Everything is namespaced by the host, so a plugin holds no string it could point
at another plugin's rows. Disposal is exact-once and reverse-order, which is why
a timer belongs in `background` or `onDispose` rather than a module-level
variable.

**A refusal is a value.** An RPC method answers `{ ok: true, value }` or
`{ ok: false, error }` at HTTP 200 — the call reached the plugin and the plugin
said no. The error codes are `invalid_json`, `invalid_input`, `handler_error`,
`invalid_output` and `unknown_method`.

`PluginSchema` is the Standard Schema v1 subset used for `input`/`output`, so Zod
4, Valibot, ArkType or a hand-written `~standard.validate` all satisfy it. The
SDK carries no validator of its own.

A server-only plugin (no `app`) is legitimate: a background job that owns
storage and answers RPC but draws nothing.

`KabmoPluginApi` / `KabmoPluginFactory` are the current names; `ChamberPluginApi`
and `ChamberPluginFactory` remain as aliases so a plugin's `server.ts` signature
keeps compiling.

## Helpers

### `stripKabmoHostEnv(env, platform)`

Returns a copy of `env` with the variables the **host** owns removed — `PORT`,
`HOST`, `NODE_ENV`, `KABMO_UI_PASSWORD`, and anything under the `NEXT_` prefix.
A child that inherits them misreads them as its own: a project's `dev` script
started under a Kabmo on 3001 would refuse to boot because the port looks taken,
and would come up in production mode.

Use it before any `Bun.spawn` of the user's process. It returns a copy — pass it
as the child's `env`, because an explicit `env` replaces the environment rather
than merging into it. `platform` is an argument rather than read from `process`
because this module is reachable from a plugin's app bundle, and Windows
variable names are case-insensitive.

`KABMO_HOST_ENV_NAMES` and `KABMO_HOST_ENV_PREFIXES` are the lists themselves.

### `PLUGIN_SURFACE_ATTR` / `pluginSurfaceSelector(pluginId)`

The attribute (`data-plugin-surface`) every element a plugin's DOM lives in
carries, and the selector the host wraps a plugin's stylesheet in
(`@scope ([data-plugin-surface="<id>"])`). The host writes the attribute; a
plugin writes ordinary CSS and it matches only its own DOM. Marking `<html>`
instead is a leak — it is an ancestor of the host's chrome too.

## Testing

`@kabmo-labs/kabmo-sdk/testing` is a second implementation of the host's
contract, not a wrapper over Kabmo's source: it validates registrations with the
same rules and the same messages, so a test catches what the host would refuse.

```ts
import { createFakeKabmoHost } from '@kabmo-labs/kabmo-sdk/testing';

const { harness } = createFakeKabmoHost({ pluginId: 'demo' });
expect(harness.setup(definition)).toBe(true);
expect(harness.registrations.rightPanel?.id).toBe('info');
harness.setPanelContext({ sessionId: 's2' });
```

| Export | What it does |
|---|---|
| `createFakeKabmoHost({ pluginId, panel?, files? })` | Installs the runtime global and the kit's services, returns `{ host, harness }`. |
| `harness.setup(definition)` | Runs `setup` against a validating registrar; a throw is recorded in `harness.failures` and nothing is kept. |
| `harness.registrations` | The positional registrations, every list slot's rows, titles and sizing. |
| `harness.setPanelContext(...)` | Move the context and wake every `usePanelInfo` reader. |
| `harness.session` | The per-session slots, for asserting what a plugin persisted. |
| `harness.dispose()` | Remove the runtime global and restore the kit's previous services. |
| `makePanelContext` / `makePanelHostProps` / `makeUiKitServices` | Deterministic fixtures for the same values. |
| `createFakeSidebar` | A driveable sidebar with the host's refusal rules. |

`@kabmo-labs/kabmo-sdk/testing/app` adds the rendering half. It needs a DOM —
install happy-dom globals in the test first.

```ts
import { loadPluginApp, renderPanel } from '@kabmo-labs/kabmo-sdk/testing/app';
import * as appModule from './app';

const app = loadPluginApp(appModule);
const slot = renderPanel(app.harness.pluginId);
expect(slot.container.textContent).toContain('Session Info');
slot.unmount();
```

`loadPluginApp` takes the imported namespace, the definition itself, or a thunk
returning either — but the thunk must be synchronous. An `() => import('./app')`
returns a Promise and is refused, so `await` the import first.

`renderSlot(registration, props)` renders any one registration, wrapping a panel
in the host's `PanelHostProvider` so `usePanelHost()` answers what a panel body
sees. `renderPanel(pluginId, props?)` renders the right panel a loaded plugin
registered.

## Package layout

| File | Contents |
|---|---|
| `src/app.ts` | The app contract and `definePluginApp`. |
| `src/backend.ts` | The server contract (`KabmoPluginApi`). |
| `src/slots.ts` | The list slots, `LIST_SLOT_NAMES`, `GLOBALLY_KEYED_SLOTS`. |
| `src/slots-agent.ts` | The slots that reach into the conversation. |
| `src/slots-sidebar.ts` | The sidebar read and actions (experimental). |
| `src/env.ts` | The host-owned environment variables and the strip rule. |
| `src/scope.ts` | The CSS surface attribute and selector. |
| `src/testing/` | The fake host, fixtures and rendering helpers. |

## Releases and license

The package is versioned from commits by the repository's release pipeline —
never bumped by hand. The manifest declares `MIT`; see the repository's
[LICENSE](https://github.com/kabmo-labs/kabmo/blob/main/LICENSE) for the terms, which
govern this package too.
