export type PluginKind = 'marketplace' | 'package';

export type PluginScope = 'user' | 'project';

/** One optional feature a plugin declares in its `package.json` `omp.features`. */
export interface PluginFeatureSpec {
  name: string;
  description?: string;
  /** Enabled when `enabledFeatures` is null — omp's own default policy. */
  isDefault?: boolean;
}

/** One entry of a plugin's `omp.settings` schema, as omp declares it. */
export interface PluginSettingSpec {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description?: string;
  /** Masked in the pane; omp never echoes the stored value back either. */
  secret?: boolean;
  /** Environment variable omp falls back to when no value is stored. */
  env?: string;
  default?: string | number | boolean;
  /** Allowed values for `type: 'enum'`. */
  values?: string[];
  min?: number;
  max?: number;
  step?: number;
}

/**
 * An installed plugin.
 *
 * Two kinds, because omp keeps them in two registries: `marketplace` entries
 * live in `installed_plugins.json` under an `name@marketplace` id, while
 * `package` entries (npm, git and `omp plugin link`) live in the plugins root's
 * `package.json` dependencies plus `omp-plugins.lock.json`. Both load through
 * the same runtime surface, so both are listed here.
 */
export interface PluginItem {
  /** `name@marketplace` for a marketplace plugin, the package name otherwise. */
  id: string;
  name: string;
  /**
   * The name omp's `features` / `config` commands resolve and the key
   * `omp-plugins.lock.json` stores state under. Equal to `name` for a package
   * plugin; a marketplace plugin's PACKAGE name otherwise
   * (`@local/manifest-plugin`, not `manifest-plugin@local-mkt`) — omp resolves
   * those two commands from the plugin's `node_modules` entry, so a bare
   * catalog name exits 1 with `Plugin "<name>" not found`.
   */
  packageName: string;
  version: string;
  kind: PluginKind;
  scope: PluginScope;
  enabled: boolean;
  description: string;
  homepage?: string;
  /** Marketplace that supplied it (marketplace kind only). */
  marketplace?: string;
  installPath?: string;
  /** Set when an enabled project install shadows this user install. */
  shadowedBy?: 'project';
  /** null means "omp's defaults" — the features marked `isDefault`. */
  enabledFeatures: string[] | null;
  features: PluginFeatureSpec[];
  /**
   * False when omp's `features` command cannot act on this install — a
   * project-scoped marketplace plugin. Absent means editable.
   */
  featuresEditable?: boolean;
  /** Why `featuresEditable` is false, shown in place of the save controls. */
  featuresNote?: string;
  settings: PluginSettingSpec[];
  /** Stored values for `settings`, keyed by setting key. Secret values are
   *  NEVER included — see `secretSet`. */
  settingValues?: Record<string, unknown>;
  /** Keys whose `secret: true` setting has a stored value. The value itself is
   *  read by omp, not by Kabmo, so the pane can only offer to clear it. */
  secretSet?: string[];
  /** Catalog version when it is newer than the installed one. */
  updateAvailable?: string;
}

/** A configured marketplace catalog (`~/.omp/marketplaces.json`). */
export interface PluginMarketplaceItem {
  name: string;
  /** `github` | `git` | `url` | `local`. */
  sourceType: string;
  sourceUri: string;
  addedAt: string;
  updatedAt: string;
  /** Catalog entries, or null when the cached catalog could not be read. */
  pluginCount: number | null;
  error?: string;
}

/** One plugin a marketplace catalog offers. */
export interface PluginCatalogItem {
  name: string;
  marketplace: string;
  description: string;
  category?: string;
  homepage?: string;
  version?: string;
  /** True when this id is already installed in any scope. */
  installed: boolean;
}
