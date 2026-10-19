/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The installed-plugin inventory behind Kabmo's Plugins settings.
 *
 * omp keeps two registries and Kabmo must merge them without inventing a
 * third:
 *
 * - `omp plugin list --json` → `{ npm, marketplace }`. `npm` is the plugins
 *   root's dependency map unioned with `omp-plugins.lock.json` (so a
 *   `plugin link` is listed too) and already carries `enabled` /
 *   `enabledFeatures` plus the parsed manifest. `marketplace` holds
 *   `{ id, scope, entries, shadowedBy? }`.
 * - A marketplace entry has NO features and NO settings of its own: its
 *   manifest lives in the cached install directory, and its runtime state is in
 *   the scope's lockfile keyed by PACKAGE NAME, not by plugin id
 *   (`@local/manifest-plugin`, not `manifest-plugin@local-mkt`). Reading the id
 *   against the lockfile reports "no features" for every marketplace plugin —
 *   measured, and the reason `readPluginPackageName` exists.
 *
 * `cwd` is the scope selector throughout, because that is what omp reads the
 * project registry from: a workspace cwd sees that workspace's project installs
 * alongside the user ones, while `$HOME` (not a project anchor) sees only the
 * user scope.
 */

import { homedir } from 'os';
import type { PluginCatalogItem, PluginItem, PluginScope } from '@/shared/types';
import { LIST_TIMEOUT_MS, runPluginCli } from '@/server/lib/omp/config/plugin-cli';
import {
  projectPluginsDir,
  readCatalogPlugins,
  readLockFile,
  readMarketplaces,
  readPluginManifest,
  readPluginPackageName,
  userPluginsDir,
  type PluginLockFile,
} from '@/server/lib/omp/config/plugin-registry';

interface CliInstalledPlugin {
  name?: unknown;
  version?: unknown;
  path?: unknown;
  manifest?: unknown;
  enabled?: unknown;
  enabledFeatures?: unknown;
}

interface CliMarketplacePlugin {
  id?: unknown;
  scope?: unknown;
  shadowedBy?: unknown;
  entries?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asFeatureList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * A manifest's description, from the CLI's already-parsed copy.
 *
 * The CLI reads the same `package.json.omp` → `.pi` chain the registry reader
 * does, so this is only a fallback for a package whose install directory is
 * gone; the features and settings always come from `readPluginManifest`, which
 * is the copy the pane renders sections from.
 */
function manifestFromCli(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return asString((value as Record<string, unknown>).description);
}

/** Catalog version newer than the installed one — omp's own upgrade rule. */
function isNewerVersion(candidate: string | undefined, installed: string): boolean {
  if (!candidate || candidate === installed) return false;
  try {
    return Bun.semver.order(candidate, installed) > 0;
  } catch {
    return true;
  }
}

/**
 * A plugin's stored setting values, with the SECRET ones reduced to presence.
 *
 * Read from the USER lockfile in both scopes, because that is where omp keeps
 * them: `omp plugin config set/delete` save through `PluginManager`'s single
 * runtime config (`getPluginsLockfile()`) and the runtime reads them back the
 * same way (`getPluginSettings(name, cwd)` merges that global map with the
 * project overrides file) — unlike `enable`/`disable`, the config commands have
 * no `--scope` at all. Reading the scope's lockfile here reports "no settings"
 * for every project-scoped install (verified: `config set` from a workspace cwd
 * wrote `~/.omp/plugins/omp-plugins.lock.json` and left the project lock's
 * `settings` empty).
 *
 * `omp-plugins.lock.json` holds plugin settings in plaintext, and the pane is a
 * browser surface — so an API key never leaves the server. A secret key is
 * reported as "set" (the pane offers to clear it) but its value is never sent,
 * which is also the only honest answer: omp's own `config list` masks it.
 */
function pluginSettingState(
  specs: readonly { key: string; secret?: boolean }[],
  stored: Record<string, unknown> | undefined,
): { settingValues?: Record<string, unknown>; secretSet?: string[] } {
  if (specs.length === 0) return {};
  const values = stored ?? {};
  const settingValues: Record<string, unknown> = {};
  const secretSet: string[] = [];
  for (const spec of specs) {
    if (!(spec.key in values)) continue;
    if (spec.secret) secretSet.push(spec.key);
    else settingValues[spec.key] = values[spec.key];
  }
  return {
    ...(Object.keys(settingValues).length ? { settingValues } : {}),
    ...(secretSet.length ? { secretSet } : {}),
  };
}

/** Every installed plugin, both registries merged into one list. */
export async function listPlugins(cwd: string): Promise<PluginItem[]> {
  const result = await runPluginCli(['list', '--json'], cwd, LIST_TIMEOUT_MS);
  if (!result.ok) return [];
  let parsed: { npm?: unknown; marketplace?: unknown };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return [];
  }

  const npm = Array.isArray(parsed.npm) ? (parsed.npm as CliInstalledPlugin[]) : [];
  const marketplace = Array.isArray(parsed.marketplace) ? (parsed.marketplace as CliMarketplacePlugin[]) : [];
  const installedIds = new Set<string>();
  for (const entry of marketplace) {
    const id = asString(entry.id);
    if (id) installedIds.add(id);
  }
  const catalogByName = new Map(
    (await readCatalogPlugins(installedIds)).map((item) => [`${item.name}@${item.marketplace}`, item]),
  );

  const isUserCwd = cwd === homedir();
  const [userLock, projectLock] = await Promise.all([
    readLockFile(userPluginsDir()),
    isUserCwd
      ? Promise.resolve<PluginLockFile>({ plugins: {}, settings: {} })
      : readLockFile(projectPluginsDir(cwd)),
  ]);

  const items: PluginItem[] = [];

  for (const raw of npm) {
    const name = asString(raw.name);
    // `omp` itself lands in this dependency map when a git spec installed the
    // agent's own package; it is not a plugin the user manages here.
    if (!name || name === 'omp') continue;
    const installPath = asString(raw.path);
    const manifest = await readPluginManifest(installPath);
    const state = userLock.plugins[name];
    const enabledFeatures = state
      ? (state.enabledFeatures ?? asFeatureList(raw.enabledFeatures))
      : asFeatureList(raw.enabledFeatures);
    items.push({
      id: name,
      name,
      packageName: name,
      version: asString(raw.version),
      kind: 'package',
      scope: 'user',
      enabled: raw.enabled !== false && state?.enabled !== false,
      description: manifest.description || manifestFromCli(raw.manifest),
      ...(installPath ? { installPath } : {}),
      enabledFeatures,
      features: manifest.features,
      settings: manifest.settings,
      ...pluginSettingState(manifest.settings, userLock.settings[name]),
    });
  }

  for (const raw of marketplace) {
    const id = asString(raw.id);
    if (!id) continue;
    const at = id.lastIndexOf('@');
    const name = at > 0 ? id.slice(0, at) : id;
    const marketplaceName = at > 0 ? id.slice(at + 1) : '';
    const scope: PluginScope = raw.scope === 'project' ? 'project' : 'user';
    const entries = Array.isArray(raw.entries) ? (raw.entries as Array<Record<string, unknown>>) : [];
    const first = entries[0] ?? {};
    const installPath = asString(first.installPath);
    const packageName = await readPluginPackageName(installPath, name);
    const lock = scope === 'project' ? projectLock : userLock;
    const state = lock.plugins[packageName];
    const manifest = await readPluginManifest(installPath);
    const catalogEntry = catalogByName.get(id);
    const version = asString(first.version);
    // omp's `features` command resolves the plugin from its USER node_modules
    // (`getPluginsNodeModules()`) and writes the user lockfile. For a
    // project-scoped install that is the shadowed copy: omp reports success and
    // the ACTIVE plugin keeps the project lockfile's selection — verified on
    // 18.4.4, where `features --set alpha` on a project-shadowed pair wrote the
    // user lock and left the project lock's `enabledFeatures` null. Offering the
    // control would promise a change that cannot take effect.
    const featuresEditable = scope === 'user';
    items.push({
      id,
      name,
      packageName,
      version,
      kind: 'marketplace',
      scope,
      enabled: first.enabled !== false && state?.enabled !== false,
      description: manifest.description || catalogEntry?.description || '',
      ...(marketplaceName ? { marketplace: marketplaceName } : {}),
      ...(installPath ? { installPath } : {}),
      ...(raw.shadowedBy === 'project' ? { shadowedBy: 'project' as const } : {}),
      enabledFeatures: state?.enabledFeatures ?? null,
      features: manifest.features,
      ...(featuresEditable
        ? {}
        : {
            featuresEditable: false,
            featuresNote:
              'omp sets plugin features through its user plugin root, so a project-scoped install\u2019s selection cannot be changed from here — omp would write the user copy, which this install shadows. Edit the workspace\u2019s .omp/plugins/omp-plugins.lock.json directly, or install the plugin at the user scope.',
          }),
      settings: manifest.settings,
      ...pluginSettingState(manifest.settings, userLock.settings[packageName]),
      ...(catalogEntry?.homepage ? { homepage: catalogEntry.homepage } : {}),
      ...(isNewerVersion(catalogEntry?.version, version) ? { updateAvailable: catalogEntry?.version } : {}),
    });
  }

  return items;
}

/** Every plugin every configured marketplace offers. */
export function readMarketplaceCatalog(installed: ReadonlySet<string>): Promise<PluginCatalogItem[]> {
  return readCatalogPlugins(installed);
}

export { readMarketplaces };
