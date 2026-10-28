/**
 * The panel-plugin registry's own types: what the server reports about an
 * install, its freshness and the catalogs it came from.
 *
 * Split from `panels.ts` (the manifest, the plugin's own contract) because the
 * two are read by different halves of the app: a plugin AUTHOR writes a manifest
 * and never sees a `PanelPluginStatus`, while the pane reads the status and never
 * parses a manifest. Keeping them in one file put a 430-line module in front of
 * both.
 */

import type { PanelPluginAuthor, PanelPluginOrigin, PanelSlotName } from '@/shared/types/panels';

/** A marketplace as the client sees it: no filesystem paths. */
export interface PanelMarketplaceItem {
  id: string;
  name: string;
  description?: string;
  /** Panels this marketplace contributed. */
  panelCount: number;
  /** Catalog entries that could not be resolved, with their reason. */
  errors: PanelPluginError[];
}

/**
 * One installed plugin, as the client sees it.
 *
 * Deliberately carries no filesystem path: the plugin's directory is a
 * server-side detail the bundle route resolves from the registry itself, and
 * sending it to the browser would publish the user's home directory layout for
 * no consumer.
 */
export interface PanelRegistryEntry {
  pluginId: string;
  name: string;
  version: string;
  /** Absolute URL of the plugin's ESM bundle, content-addressed per build. */
  appUrl: string;
  /**
   * Absolute URL of the plugin's stylesheet, content-addressed per build.
   *
   * Present only when the plugin declares `css` AND the file exists, so a plugin
   * with no stylesheet costs nothing. The client loads it while the plugin has a
   * live content-script generation and unloads it when the last one goes.
   */
  cssUrl?: string;
  /** Absolute URL of the plugin's icon, when it declares one. */
  iconUrl?: string;
  /** Absolute URL of the plugin's README, when it ships one. */
  readmeUrl?: string;
}

/**
 * Why a plugin directory was skipped, so the UI can report it instead of hiding it.
 *
 * `marketplace` is filled in by the scan so the pane can group a rejection under
 * the marketplace it came from. Deriving that in the UI would mean matching on
 * the path, which breaks the moment two marketplaces share a directory name.
 *
 * `source` is filled in for ONE rejection — a catalog entry naming a directory
 * that is not there. That row is the only one a user can act on from the pane
 * (forget the entry), and the entry is addressed by its source path, so the
 * server has to say which one it read rather than letting the client rebuild the
 * path from `dir`: the catalog's `source` is free-form relative text, and a path
 * reconstructed from the resolved directory would be a second, lossy encoding of
 * the same fact.
 */
export interface PanelPluginError {
  dir: string;
  reason: string;
  marketplace?: string;
  /** The catalog entry's `source`, on a dangling-entry rejection. */
  source?: string;
}

/**
 * The last known freshness of a git-installed plugin.
 *
 * A plugin installed from a git URL is a CLONE, so its `.git` directory is the
 * only record of where it came from — the marketplace catalog names a relative
 * path, not a URL. That is why the origin is derived from the clone itself (see
 * `git-origin.server.ts`) rather than stored beside the catalog entry: a value
 * the user could edit into disagreement with the directory would be a second
 * answer to the same question.
 *
 * `current` and `latest` are commit SHAs, not versions: a plugin repository
 * publishes no release, so the only honest comparison is the commit the working
 * copy sits on against the commit the remote's HEAD names.
 */
export interface PanelGitStatus {
  /** The commit the installed clone is at, or null when it could not be read. */
  current: string | null;
  /** The commit the remote's HEAD names, or null when the probe failed. */
  latest: string | null;
  /**
   * The version the remote's manifest declares, when the probe could read it.
   *
   * A commit SHA answers "is this clone behind" but not "which version is
   * newer", and the pane shows a version on every card — so the probe fetches
   * the remote's manifest once when the SHAs differ. Absent means the remote's
   * version is unknown (a probe that only compared refs), never "same".
   */
  latestVersion?: string;
  /** True when the two differ — the clone is behind the remote. */
  updateAvailable: boolean;
  /** When the probe last ran, or null when it never has. */
  checkedAt: number | null;
  /** Why the probe failed. Absent when it succeeded. */
  error?: string;
}

/**
 * One installed plugin's build state.
 *
 * A plugin is a Bun package, so its UI is served from a BUILD output (`dist/`)
 * rather than from its sources. A plugin whose build has not run — freshly
 * cloned, or a build that failed — therefore has a valid manifest and no
 * importable bundle, and that is a different condition from a rejected manifest:
 * the pane offers a Rebuild for it instead of reporting it as broken.
 */
export interface PanelPluginStatus {
  pluginId: string;
  name: string;
  /**
   * The version the INSTALLED manifest declares.
   *
   * Read here rather than at render time because the freshness question needs
   * both sides in one place: the store's copy and the installed copy are
   * different directories, and a row that showed only one of them could not say
   * whether the install is behind.
   */
  version: string;
  /** True when the bundle its manifest names exists on disk. */
  built: boolean;
  /** Why the last build did not produce the bundle, when it did not. */
  reason?: string;
  /** Whether the plugin is a Bun package (has a package.json). */
  isPackage: boolean;
  /**
   * Whether the plugin's contributions are live.
   *
   * Installing and enabling are two separate steps on purpose: a bundled plugin
   * arrives in the catalog UNINSTALLED (VS Code's model — the marketplace is a
   * store, not a preinstalled set), and an installed plugin can be switched off
   * without deleting its directory. A disabled plugin contributes nothing —
   * no activity-bar button, no header button, no editor tab — and its bundle is
   * no longer served.
   */
  enabled: boolean;
  /** Whether the plugin came from the bundled marketplace rather than a git URL. */
  bundled: boolean;
  /**
   * Where this install came from, as one value.
   *
   * `bundled` means Kabmo's own store supplied it and the boot-time sync keeps
   * it current; `git` means a clone the user owns and updates by hand (or by
   * auto-update); `local` is a directory dropped into the marketplace, which
   * nothing updates. It is DERIVED (origin URL, store membership) rather than
   * stored, for the same reason `gitOrigin` is read off the clone.
   */
  origin: PanelPluginOrigin;
  /** The manifest's description, so a card can explain itself. */
  description?: string;
  author?: PanelPluginAuthor;
  homepage?: string;
  /** The slots the manifest DECLARES; live registrations are authoritative. */
  slots?: PanelSlotName[];
  capabilities?: string[];
  /** How many settings the manifest declares, so the card can say what is configurable. */
  settingsCount?: number;
  /**
   * The version the SOURCE offers, when it is known and newer.
   *
   * For a bundled install it is the store's copy; for a git clone it is read
   * from the remote's manifest by the freshness probe. Absent means "unknown",
   * never "current" — a clone whose remote was never asked has no latest.
   */
  latestVersion?: string;
  /**
   * The clone's `origin` URL, or null when the plugin is not a git clone.
   *
   * Read off the plugin's own `.git` rather than recorded at install time: the
   * directory IS the install, so a URL that could be edited apart from it would
   * be a second answer to the same question. A non-null value is what makes the
   * pane offer Update and what the auto-update pass selects on.
   */
  gitOrigin: string | null;
}

/**
 * One plugin the bundled marketplace offers, whether or not it is installed.
 *
 * The catalog is what the Panel Plugins pane lists as AVAILABLE: the bundled
 * marketplace is a store the user installs from, so a plugin sitting in
 * `<package>/marketplace/plugins/` is an offer, not an install. A catalog entry
 * cannot describe what a plugin CONTRIBUTES — that is known only after its
 * bundle loads — so the row carries the identity alone.
 */
export interface PanelCatalogEntry {
  pluginId: string;
  name: string;
  version: string;
  description?: string;
  /** Absolute URL of the plugin's icon, when the store's copy declares one. */
  iconUrl?: string;
  /** Absolute URL of the plugin's README, when the store's copy ships one. */
  readmeUrl?: string;
  /** True once the plugin is installed — the row then offers Enable/Remove. */
  installed: boolean;
  /**
   * Where installing this offer would bring the code FROM.
   *
   * `bundled` is the copy inside the package; `git` is a URL listed in
   * `marketplace.json`, which `install` clones. The card says which, because
   * the two behave differently afterwards: one is kept current by Kabmo's own
   * sync, the other is a clone the user owns.
   */
  origin: 'bundled' | 'git';
  /** The git URL to clone, for a `git` offer. */
  url?: string;
  author?: PanelPluginAuthor;
  homepage?: string;
  /** The slots the offer's manifest declares, for a card that cannot ask. */
  slots?: PanelSlotName[];
}

export interface PanelRegistryPayload {
  /** Installed, enabled plugins — the bundles the host should import. */
  panels: PanelRegistryEntry[];
  marketplaces: PanelMarketplaceItem[];
  errors: PanelPluginError[];
  /** Every installed plugin, with its build and enablement state. */
  plugins: PanelPluginStatus[];
  /** The bundled marketplace's offers, installed or not. */
  catalog: PanelCatalogEntry[];
  /**
   * Every panel id whose contributions are switched OFF.
   *
   * ONE set for both kinds of panel, because enablement is one question: a
   * plugin is named by `plugin:<pluginId>`, and a BUILT-IN view by its bare id
   * (`git`, `files`, …). The server only ever stores these ids — it has no
   * built-in panel list, and does not need one, because the client is what
   * resolves a bare id to a component. Carrying the set here rather than in the
   * Kabmo settings blob is what keeps ONE store: the activity-bar menu and
   * the Panel Plugins switches write the same ids through the same endpoint,
   * so the two surfaces cannot disagree about whether a panel is on.
   */
  disabledPanels: string[];
  /**
   * The last known freshness of each git-installed plugin, by plugin id.
   *
   * A separate map rather than a field on the status row because it is a
   * DIFFERENT read: the status comes from the marketplace scan (local, always
   * current), while this is the result of the last network probe. A plugin that
   * was never probed is simply absent, which the pane renders as "not checked".
   */
  gitStatus: Record<string, PanelGitStatus>;
  /** Whether git-installed plugins are updated automatically. */
  autoUpdate: boolean;
  /**
   * The bundled plugins a local edit has stopped from syncing, by plugin id.
   *
   * A refusal, not a fault: the user changed files in a plugin Kabmo
   * installed, so Kabmo leaves them alone. It travels on the payload
   * because the alternative is a plugin that silently stays on an old version
   * with nothing on screen to say why.
   */
  syncBlocked: Record<string, PanelSyncBlocked>;
}

/** A bundled plugin whose sync a local edit refused. */
export interface PanelSyncBlocked {
  /** When the sync was refused. */
  at: number;
  /** The tracked files that differ from what the install wrote, sorted. */
  changed: string[];
}
