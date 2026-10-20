# @kabmo-labs/kabmo-ui

Preact hooks and components for Kabmo panel plugins.

A plugin renders **in the host's own Preact tree** — same instance, same
document, same theme — so this kit is plain Preact rather than a message-passing
client. What it must not do is reach into Kabmo's source: it is a published
package, so the host injects its services once at boot and every hook reads them.

The package ships its TypeScript **source** (`files: ["src"]`, exports pointing
at `.tsx`) with no build step, so a plugin's own `tsc` and Bun's bundler read it
directly.

## Install

Declare it as an **optional peer**, the same way as the SDK. Kabmo links both
packages into a plugin's `node_modules` before building, and a real dependency
would make `bun install` fetch a copy the plugin must not use.

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

The build rewrites `@kabmo-labs/kabmo-ui` and `@kabmo-labs/kabmo-ui/components`
to `globalThis.__kabmoPluginRuntime.ui` / `.uiComponents`, so a plugin never
bundles a second copy. The pre-rename names (`@kabmo-labs/ui`,
`@ompchamber/ui`) are still mapped by the same shim, so an older bundle keeps
loading; write the current names in new code.

## Subpaths

| Import | What it holds |
|---|---|
| `@kabmo-labs/kabmo-ui` | Every hook, both providers, `RepoPicker`, and re-exports of the component kit. |
| `@kabmo-labs/kabmo-ui/components` | The presentation kit only — smaller import graph for a component that needs nothing else. |

## Hooks

| Hook | Returns |
|---|---|
| `usePanelInfo()` | `{ sessionId, workspacePath, theme }`, re-rendering when any of them changes. |
| `useTheme()` | The live palette id. |
| `usePanelHost()` | The props of the panel this component is rendered in: `enabled`, `active`, `refreshKey`, `rootPath`, `onRefresh`, `onOpenFile`, `onClose`, `showHeader`. |
| `usePluginId()` | The plugin whose subtree this is, or `null` outside one. |
| `useSessionValue(key, delayMs?)` | `{ value, status, error, update }` — per-session string state, debounced on write. |
| `useSessionState(key, fallback)` | `[value, setValue, ready]` — per-session state of any JSON shape. |
| `useWorkspaceFile(relativePath)` | `{ content, loading, error }` — a text file inside the active workspace. |
| `useKabmoFetch(url, options?)` | `{ data, isLoading, error, reload }` — a direct read of Kabmo's HTTP API. |
| `useRpc(method)` | `{ call, value, error, pending }` — one of this plugin's server methods. |
| `useRealtime()` | `{ value, isLoading, stale, refresh }` — this plugin's own topic. |
| `useComposer()` | `{ text, isEmpty, isSubmitting, scope, set, insert, focus }` — the composer's live state and writes. |
| `useRepoScope()` | The shared nested-repo scope, plus `setRepo` and `refresh`. |
| `experimental_useSidebarThreads()` | `{ threads, isLoading, stale, refresh }` — the sessions the sidebar is showing. |
| `experimental_useSidebarThreadActions()` | `{ open, rename, setArchived, markSeen, remove, openNew, error }`. |

Three rules the hooks exist to enforce, because a plugin gets them wrong:

- **Context arrives late.** The active session and workspace resolve
  asynchronously, so a component that captured them once would show "none" over
  a real workspace. Every hook subscribes and re-renders.
- **Session state is not component state.** A panel is unmounted when another
  view is shown, so a value kept in `useState` alone is lost on every switch.
  `useSessionValue` and `useSessionState` read Kabmo's store, and both re-read
  when anything else writes the same key — a field and a readout of one value
  cannot disagree. A component's own edit is exempt, or the debounce would erase
  what the user typed.
- **A refusal is a value.** `useRpc` answers `{ ok: false, error }` for a plugin's
  own refusal and keeps the reason on `error`; it does not reject. A superseded
  call is dropped, so a slow first call cannot repaint what a faster second one
  already moved.

`useKabmoFetch` is for a plugin reaching an HTTP endpoint directly. It drops a
late answer for a request the user has moved past, clears the previous payload
before reading a new URL, and issues no request while `enabled` is false — which
is what a view passes while it is hidden. Kabmo's own views do not use it — they
read the realtime socket, which is not part of this kit's surface.

`useComposer` writes through the composer's own state, never the DOM. The
textarea is controlled, so a DOM write is reverted by the next keystroke and the
edit vanishes with no error. `insert` places at the caret and moves it past.

## Components

```tsx
import { Panel, Field, FieldList } from '@kabmo-labs/kabmo-ui/components';
```

| Component | What it draws |
|---|---|
| `Panel` | A panel's outer chrome: a title bar over a scrolling body. |
| `Field` | One labelled fact — a micro-header label and a machine-text value. |
| `FieldList` | A stack of `Field`s. |
| `TextAreaField` | A labelled textarea. |
| `Button` | A button. `variant="primary"` is the one action a panel wants the user to take. |
| `Empty` | A centred placeholder for a panel with nothing to show. |
| `Note` | A message. `tone="error"` is the only chroma a panel should use. |
| `Markdown` | Renders through Kabmo's own pipeline. |

`Markdown` is injected, not bundled: Kabmo's marked / KaTeX / mermaid / Shiki
chain plus its file-opening and clipboard hooks is a large tree a plugin must not
carry twice. Against a host that injects nothing it renders the source as plain
text — degraded, not broken.

## Providers

`PanelHostProvider` and `PluginIdProvider` are what the host renders around a
plugin's surface. A plugin normally never renders them itself: `renderSlot` from
the SDK's testing harness wraps a panel in `PanelHostProvider`, and the real
layouts wrap every plugin surface in both.

`PluginIdProvider` is load-bearing twice: it is how `useRpc` resolves *which*
plugin's namespace to call (so a component rendered for one plugin can never
address another's), and it is the DOM node a plugin's stylesheet is scoped to —
`@scope ([data-plugin-surface="<id>"])`. It renders a `<span style="display:
contents">`, which generates no box, so it cannot disturb the host's layout.

A test that renders a component using `useRpc` or `useRealtime` must wrap it in
`PluginIdProvider` itself — `renderSlot` supplies only the panel props, and a
component with no plugin id answers `no_plugin`.

## Repo scope

`useRepoScope()` and `RepoPicker` describe the nested repository the Files,
Search, Source Control and Terminal panels share. There is ONE selection slot for
all of them, so picking a repo in a plugin's picker moves those panels and vice
versa.

```tsx
import { RepoPicker, useRepoScope } from '@kabmo-labs/kabmo-ui';

function Toolbar() {
  const scope = useRepoScope();
  return <RepoPicker scope={scope} />;
}
```

The value is a path **relative to the workspace root**, and the host stores the
root alongside it — a pick made under another workspace is not this workspace's
pick. The hook resolves that; a plugin never compares roots itself. Against a
host too old to provide the service, the hook reports an empty scope rather than
throwing, so a panel draws "no workspace" instead of breaking.

`RepoPicker` is the same control the host's own panels draw, including the label
rules (the root reads as its folder's name, a list row keeps its whole path, the
trigger truncates). `onManage` adds an optional row for a host that has a larger
repo manager; absent, no row is drawn.

## Styling

Use Kabmo's Tailwind utilities and theme variables directly — `bg-paper`,
`text-ink`, `border-ink/10`, `text-error`. A plugin renders in the host's
document, so those classes are already in the stylesheet and the palette applies
for free. There is no stylesheet to import.

A plugin installed into `~/.kabmo/marketplace/` sits outside the project root,
so Tailwind's scan does not see its own class names. Prefer the kit's components,
and use inline styles for anything the kit does not cover.

A plugin's own stylesheet is served wrapped in `@scope`, so it matches only the
plugin's own DOM. Importing one works, but it must be declared in the manifest
(`"kabmo": { "css": "dist/app.css" }`) — otherwise it is built, served by
nothing, and silently not applied. The host loads it as a `<link>` for as long
as the plugin has a live content script, so a stylesheet needs one; a plugin
that only fills a slot uses the host's utilities and needs none.

## Testing

The kit reads its services from a module-level slot that the host fills with
`configureUiKit` at boot. A plugin's tests never call it: the SDK's fake host
does, through the same function, so the hooks work with no Kabmo running.

```ts
import { loadPluginApp, renderSlot } from '@kabmo-labs/kabmo-sdk/testing/app';
import * as appModule from './app';

const app = loadPluginApp(appModule);
const slot = renderSlot(app.harness.registrations.rightPanel!, {
  sessionId: 's1',
  workspacePath: '/ws',
});
expect(slot.container.textContent).toContain('/ws');
```

The rendering half needs a DOM: install happy-dom globals in the test before
rendering. `renderSlot` installs both halves itself and wraps a panel in the
host's `PanelHostProvider`; a component that calls `useRpc` or `useRealtime`
additionally needs `PluginIdProvider` around it.

`requireServices()` throws when the kit is used outside the app, naming the real
problem. `uiKitServices()` returns the services as they stand, or `null`.

## Package layout

| File | Contents |
|---|---|
| `src/services.ts` | `UiKitServices`, `PanelContext`, `PanelHostProps`, `RepoScope`, `configureUiKit`. |
| `src/panels.ts` | `usePanelInfo`, `useTheme`, `useSessionValue`, `useSessionState`, `useWorkspaceFile`. |
| `src/participant.ts` | `useRpc`, `useRealtime`, `useComposer`. |
| `src/fetch.ts` | `useKabmoFetch` and `DEFAULT_POLL_MS`. |
| `src/repo.ts` / `src/repo-picker.tsx` | The repo scope hook and the shared picker. |
| `src/sidebar.ts` | The experimental sidebar hooks. |
| `src/panel-host.tsx` / `src/plugin-id.tsx` | The two providers. |
| `src/components.tsx` | The presentation kit. |

## Releases and license

The package is versioned from commits by the repository's release pipeline —
never bumped by hand. The manifest declares `UNLICENSED`; see the repository's
own License section for the terms, which govern this package too.
