# Built-in Panels Are Plugins

Every right-panel view in Kabmo — the eleven Kabmo ships and the ones
installed from a plugin — now travels ONE path: a registration, one merged
catalog, and one enablement store. A built-in view behaves like a plugin that
arrived already installed and already switched on; the only difference is that
its install cannot be undone, because its code is in the app's own bundle.

## What "a plugin" means here

A plugin contributes views by registering them at load:

```tsx
export default definePluginApp((app) => {
  app.rightPanel({ id: 'info', title: 'Session Info', component: SessionInfo });
});
```

A built-in view does the same thing in its own table
(`src/client/components/workspace/panels/builtin.tsx`): an id, a title, a label,
an icon, a `lazy()` component, its sizing, and whether it needs a workspace
folder. `RIGHT_PANEL_TYPES` stays the single source of the ORDER — it is shared
(no client import) because the width map and the persisted-id guard read it too —
and the geometry comes from the tables that were already keyed by it.

The layout never learns which kind a view is:

| Surface | Reads |
|---|---|
| Activity bar, phone's tab strip | `usePanelCatalog()` — built-ins first, then plugins |
| Desktop panel stack | the same catalog, through each entry's `render(props)` |
| Width, floor, open size | the entry's own `minWidth` / `defaultWidth` / `defaultFraction` |
| Enablement | one set of ids |

## Enablement: one axis, one store

Disabling and hiding used to be two axes with two stores, and hiding was the
built-ins' only one (`hiddenRightPanels` in Kabmo settings blob). There is
now one axis, and it is the plugin one:

| Action | What it changes |
|---|---|
| **Disable** | The id joins the disabled set. The view leaves the bar and its body is not drawn. For a PLUGIN the bundle also stops being served, which is what makes disabling stop the code rather than only hide a button. |
| **Enable** | The id leaves the set. The view returns; a plugin's bundle is served again. |

Ids are uniform, and the PREFIX is what keeps the two kinds apart:

- a built-in view is named by its bare id — `git`, `files`, `terminal`;
- a plugin is named by `plugin:<pluginId>` — the same key the client filters its
  catalog by and the same key the server tests before publishing a bundle.

The server stores whatever it is given and never needs to know which ids are
built-in: `disabledPanels` travels on `GET /api/panels` and the client resolves
its own views against it.

**Absent means enabled.** That is what makes a freshly installed plugin live
immediately, what makes every built-in view present on a fresh install, and what
keeps a database written before this feature from switching everything off.

### Where the switch lives

Two surfaces, one write:

- **The activity bar's right-click menu** — every panel, on or off, with its
  checkbox. A view that is switched off leaves the bar but KEEPS its row here,
  which is the only place it can be switched back on. Nothing is pinned any more:
  a built-in view is as switchable as a plugin.
- **Settings → Panel Plugins** — a `Built-in` group listing all eleven views with
  the same switch a plugin card gets, and no Remove (there is nothing to remove:
  the code is in the bundle).

Both call the same `setEnabled(id, enabled)`, so they cannot disagree.

### The one migration

A list of hidden ids becomes a list of disabled ones, once, when the disabled set
is first read (`migrateHiddenPanels`, `src/server/lib/panels/state.server.ts`).
It is guarded by the old key's PRESENCE and deletes that key as it goes, so it is
idempotent: a second read finds nothing to fold, and a view the user switches
back on afterwards cannot be re-adopted. An entry already in the disabled set
wins — it is the newer store.

## Adding a built-in view

One row in `builtin.tsx`: the id in `RIGHT_PANEL_TYPES`, the meta, the `lazy()`
component, and the three geometry numbers. The bar, the phone's strip, the width
map, the persisted-id guard and both switch surfaces pick it up with no further
edits.

## Files

| Path | Role |
|---|---|
| `src/client/components/workspace/panels/builtin.tsx` | The eleven views: id, meta, component, sizing, `requiresWorkspace` |
| `src/client/components/workspace/plugin-panel/resolve.tsx` | `usePanelCatalog()` — the merged list both layouts render |
| `src/client/components/layout/RightActivityBar.tsx` | The bar and the enablement menu |
| `src/client/components/layout/desktop-layout/WorkspacePanels.tsx` | The desktop panel stack |
| `src/client/components/mobile/RightSidebar.tsx` | The phone's drawer |
| `src/client/components/settings/categories/panel-plugins/BuiltinList.tsx` | The `Built-in` settings group |
| `src/server/lib/panels/state.server.ts` | The disabled set and the one migration |
| `src/server/lib/panels/registry.server.ts` | Publishes `disabledPanels`; gates a plugin's bundle on its prefixed key |

Removed with the change: `panel-meta.tsx` and `lazy-panels.tsx` (both replaced by
the table above) and `hooks/workspace/panel-visibility.ts` (the hide axis).

## Verifying

```bash
bun test                       # builtin.test.ts, state.server.test.ts, registry.server.test.ts
bun run lint
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
bun run build
```

Smoke, against a real server: switch a built-in view off from the menu and from
Settings and watch it leave the bar; install a plugin and watch it arrive already
enabled; disable that plugin and watch its bundle answer `404`; reload and watch
both survive.

> Test suites that scan the panel registry must isolate their database
> (`@/test-support/isolated-db`). The scan reads the disabled set, and the handle
> is a process-wide singleton — a suite that sets `KABMO_DB_PATH` after the
> handle is open writes into the developer's real `~/.kabmo/db.sqlite`.
