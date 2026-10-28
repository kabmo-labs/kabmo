/**
 * Panel-plugin contribution types.
 *
 * A panel plugin is third-party code Kabmo loads INTO ITS OWN PAGE: the
 * bundle is a real ESM module, the host `import()`s it, and the components it
 * registers are rendered in the host's Preact tree — the same document, the
 * same theme, the same hooks. There is no iframe and no message channel, so a
 * plugin is local code, trusted the way a VS Code extension is trusted.
 *
 * The manifest therefore carries only what the host needs BEFORE the code runs:
 * an identity, an optional icon, and the bundle to import. Which panels exist,
 * their titles and their positions are decided by the registrations the bundle
 * makes when it loads.
 */

import type { PluginSettingDefinition } from '@kabmo-labs/kabmo-sdk';

/** Where a contributed panel renders. One panel per position, per plugin. */
export type PanelPosition = 'right' | 'editor' | 'header';

/**
 * The four POSITIONAL slots a plugin may fill, by their registration names.
 *
 * A manifest may DECLARE these (`slots`) so a store card can say what a plugin
 * offers before its bundle has ever run. A declaration is advisory: the live
 * registration is authoritative, and the card marks a declared-only row.
 */
export const PANEL_SLOT_NAMES = ['rightPanel', 'panel', 'headerPanel', 'settingsSection'] as const;

export type PanelSlotName = (typeof PANEL_SLOT_NAMES)[number];

/** Who wrote a plugin. `name` is required; the rest is optional. */
export interface PanelPluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

/** Where an installed plugin came from. */
export type PanelPluginOrigin = 'bundled' | 'git' | 'local';

/**
 * A plugin's own manifest (`kabmo` in `package.json`, or a standalone
 * `kabmo.json`).
 */
export interface PanelPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  /**
   * The built ESM bundle, relative to the plugin root — conventionally
   * `dist/app.js`. It is what the host `import()`s; the module's default export
   * must be a `definePluginApp(...)` definition.
   *
   * Optional since a plugin may be server-only, but at least one of `app` and
   * `server` must be present: a plugin that declares neither has nothing the
   * host could ever run.
   */
  app?: string;
  /**
   * A stylesheet the plugin's app bundle imports, relative to the plugin root —
   * conventionally `dist/app.css`.
   *
   * Bun emits an imported stylesheet BESIDE the bundle and the JS never
   * references it, so without this the file is inert: built, served by nothing,
   * and silently not applied. Declaring it is what makes the host load it for
   * as long as the plugin has a live content-script generation.
   */
  css?: string;
  /**
   * The built server entry, relative to the plugin root — conventionally
   * `dist/server.js`. Its default export is a `KabmoPluginFactory`.
   */
  server?: string;
  /**
   * Declared settings, keyed by setting name. Declarative so the host can draw
   * a form and validate a value without the plugin running.
   */
  settings?: Record<string, PluginSettingDefinition>;
  /**
   * Host versions this plugin declares it works with. Absent means "any".
   *
   * `kabmo` is the app's own version, `pluginSdk` the `@kabmo-labs/kabmo-sdk`
   * version — the two move independently, and a plugin built against a newer
   * contract must be refused rather than allowed to load and misbehave.
   */
  engines?: { kabmo?: string; pluginSdk?: string };
  /**
   * Host capabilities this plugin requires; a missing one refuses the plugin.
   *
   * The host's list is `HOST_CAPABILITIES` — the ONE table of what ships today.
   */
  capabilities?: string[];
  /** Optional icon file, relative to the plugin root. */
  icon?: string;
  /**
   * Optional README, relative to the plugin root. Markdown, shown in the pane's
   * reader so a user can judge a plugin before installing it.
   *
   * When it is absent the scan looks for `README.md` at the plugin root, which
   * is the convention every package already follows — a plugin author should not
   * have to declare a file they already wrote.
   */
  readme?: string;
  /** Optional branding block; `icon` above is authoritative when both exist. */
  branding?: { icon?: string };
  /**
   * Who wrote the plugin, so a card can credit them without opening the README.
   *
   * Declared here rather than read from `package.json.author` alone, because a
   * plugin may ship a standalone `kabmo.json` and never have a package at all.
   */
  author?: PanelPluginAuthor;
  /**
   * The slots the plugin CONTRIBUTES, declared up front.
   *
   * Advisory: a plugin's live registrations are what it actually fills, and a
   * declaration can be stale. It exists so a plugin that is not installed yet —
   * a store card — can still say what it will add, which no registration can
   * answer before the bundle runs.
   */
  slots?: PanelSlotName[];
}

/**
 * One plugin a marketplace catalog lists.
 *
 * `source` is a path RELATIVE to the marketplace root — the same convention
 * omp's own `marketplace.json` uses, so a catalog written for omp reads the
 * same way here. It is resolved under the root and may not escape it.
 *
 * A source may also be a REMOTE git URL (`https://…`, `ssh://…`, `git@…`).
 * That entry is an OFFER rather than a directory: the pane lists it as
 * installable and `install` clones it, which is what lets one `marketplace.json`
 * curate a set of plugins that do not live inside the marketplace at all.
 */
export interface PanelMarketplacePluginEntry {
  name: string;
  source: string;
  description?: string;
  version?: string;
  category?: string;
  author?: PanelPluginAuthor;
  homepage?: string;
  /** True when `source` is a remote git URL rather than a directory here. */
  remote?: boolean;
}

/**
 * A local marketplace: `marketplace.json` at its root, plugin directories under
 * `plugins/`.
 *
 * The catalog is the curated view — it carries descriptions, ordering and
 * categories — but it is not the install list: a plugin directory present under
 * `plugins/` and absent from the catalog is still loaded, because "drop a folder
 * in" has to keep working. The catalog adds metadata; the directory is what
 * makes a plugin exist.
 */
export interface PanelMarketplaceManifest {
  name?: string;
  description?: string;
  owner?: { name?: string };
  plugins?: PanelMarketplacePluginEntry[];
}

