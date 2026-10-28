/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read-only views of omp's plugin registries and marketplace catalogs.
 *
 * omp keeps four files on disk and each answers a different question:
 *
 * - `<dataRoot>/marketplaces.json` — which catalogs the user added (name,
 *   source, and the `catalogPath` of the cached copy).
 * - `<dataRoot>/plugins/installed_plugins.json` — user-scope marketplace
 *   installs, keyed by `name@marketplace`.
 * - `<scope>/plugins/installed_plugins.json` — the project-scope half, under
 *   the nearest `.omp/` or `.git` anchor.
 * - `<scope>/plugins/omp-plugins.lock.json` — the runtime state both kinds
 *   share: enabled, `enabledFeatures`, and the stored plugin settings. Keyed by
 *   PACKAGE NAME, not by plugin id, which is why a marketplace plugin's
 *   enablement is read from here rather than from its registry entry.
 *
 * Everything here is a plain file read: omp's own CLI is the only writer, and
 * Kabmo must never rewrite a registry omp owns. `plugins.ts` runs the CLI
 * for anything that mutates.
 */

import { join } from 'path';
import {
  getMarketplacesRegistryPath,
  getPluginsDir,
  getProjectPluginsDir,
  pathExists,
} from '@/server/lib/omp/core/paths';
import type {
  PluginCatalogItem,
  PluginFeatureSpec,
  PluginMarketplaceItem,
  PluginSettingSpec,
} from '@/shared/types';

/** The registry shape omp reads and writes (`version: 2`, Claude-compatible). */
interface MarketplaceRegistry {
  marketplaces?: Array<Record<string, unknown>>;
}

interface CatalogFile {
  name?: unknown;
  plugins?: unknown;
}

/** Runtime state omp stores in `omp-plugins.lock.json`. */
export interface PluginLockState {
  enabled?: boolean;
  enabledFeatures?: string[] | null;
}

export interface PluginLockFile {
  plugins: Record<string, PluginLockState>;
  settings: Record<string, Record<string, unknown>>;
}

/** A plugin's own manifest, normalized from `package.json` `omp`/`pi`. */
export interface PluginManifestView {
  description: string;
  features: PluginFeatureSpec[];
  settings: PluginSettingSpec[];
}

const CATALOG_CACHE_TTL_MS = 5_000;

declare global {
  // eslint-disable-next-line no-var
  var __ompPluginCatalogCache: Map<string, { at: number; size: number; plugins: PluginCatalogItem[] }> | undefined;
}

function catalogCache(): Map<string, { at: number; size: number; plugins: PluginCatalogItem[] }> {
  globalThis.__ompPluginCatalogCache ??= new Map();
  return globalThis.__ompPluginCatalogCache;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    if (!(await pathExists(filePath))) return null;
    return (await Bun.file(filePath).json()) as T;
  } catch {
    return null;
  }
}

/** The project-scope plugin root for a cwd — omp's own anchor walk. */
export function projectPluginsDir(cwd: string): string {
  return getProjectPluginsDir(cwd);
}

/** User-scope plugin root (`~/.omp/plugins`, or the XDG data root). */
export function userPluginsDir(): string {
  return getPluginsDir();
}

/** Read `omp-plugins.lock.json` for one plugin root. Missing means empty. */
export async function readLockFile(pluginsDir: string): Promise<PluginLockFile> {
  const raw = await readJson<PluginLockFile>(join(pluginsDir, 'omp-plugins.lock.json'));
  return {
    plugins: raw?.plugins && typeof raw.plugins === 'object' ? raw.plugins : {},
    settings: raw?.settings && typeof raw.settings === 'object' ? raw.settings : {},
  };
}

function toFeatureSpecs(value: unknown): PluginFeatureSpec[] {
  if (!value || typeof value !== 'object') return [];
  const out: PluginFeatureSpec[] = [];
  for (const [name, spec] of Object.entries(value as Record<string, unknown>)) {
    const record = (spec ?? {}) as Record<string, unknown>;
    out.push({
      name,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(record.default === true ? { isDefault: true } : {}),
    });
  }
  return out;
}

function toSettingSpecs(value: unknown): PluginSettingSpec[] {
  if (!value || typeof value !== 'object') return [];
  const out: PluginSettingSpec[] = [];
  for (const [key, spec] of Object.entries(value as Record<string, unknown>)) {
    const record = (spec ?? {}) as Record<string, unknown>;
    const type = record.type;
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') continue;
    out.push({
      key,
      type,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      ...(record.secret === true ? { secret: true } : {}),
      ...(typeof record.env === 'string' ? { env: record.env } : {}),
      ...(record.default !== undefined ? { default: record.default as string | number | boolean } : {}),
      ...(Array.isArray(record.values)
        ? { values: record.values.filter((entry): entry is string => typeof entry === 'string') }
        : {}),
      ...(typeof record.min === 'number' ? { min: record.min } : {}),
      ...(typeof record.max === 'number' ? { max: record.max } : {}),
      ...(typeof record.step === 'number' ? { step: record.step } : {}),
    });
  }
  return out;
}

/**
 * Read a plugin's manifest out of its install directory.
 *
 * omp resolves the manifest as `package.json.omp` → `.pi` → `{version}`; a
 * plugin that declares neither still installs and still loads its conventional
 * `skills/` and `commands/` content, it simply has no features or settings to
 * offer — which is why both lists come back empty rather than absent.
 */
export async function readPluginManifest(installPath: string | undefined): Promise<PluginManifestView> {
  const empty: PluginManifestView = { description: '', features: [], settings: [] };
  if (!installPath) return empty;
  const pkg = await readJson<Record<string, unknown>>(join(installPath, 'package.json'));
  if (!pkg) return empty;
  const manifest = (pkg.omp ?? pkg.pi) as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== 'object') return empty;
  return {
    description: typeof manifest.description === 'string' ? manifest.description : '',
    features: toFeatureSpecs(manifest.features),
    settings: toSettingSpecs(manifest.settings),
  };
}

/** Read a plugin's `package.json` `name`, which is the lockfile key. */
export async function readPluginPackageName(installPath: string | undefined, fallback: string): Promise<string> {
  if (!installPath) return fallback;
  const pkg = await readJson<{ name?: unknown }>(join(installPath, 'package.json'));
  return typeof pkg?.name === 'string' && pkg.name ? pkg.name : fallback;
}

/** Every configured marketplace, with its catalog size. */
export async function readMarketplaces(): Promise<PluginMarketplaceItem[]> {
  const registry = await readJson<MarketplaceRegistry>(getMarketplacesRegistryPath());
  const entries = Array.isArray(registry?.marketplaces) ? registry.marketplaces : [];
  const out: PluginMarketplaceItem[] = [];
  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) continue;
    const catalogPath = typeof entry.catalogPath === 'string' ? entry.catalogPath : '';
    const catalog = catalogPath ? await readJson<CatalogFile>(catalogPath) : null;
    const count = Array.isArray(catalog?.plugins) ? catalog.plugins.length : null;
    out.push({
      name,
      sourceType: typeof entry.sourceType === 'string' ? entry.sourceType : 'git',
      sourceUri: typeof entry.sourceUri === 'string' ? entry.sourceUri : '',
      addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : '',
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
      pluginCount: count,
      ...(count === null ? { error: 'Cached catalog not readable — update this marketplace.' } : {}),
    });
  }
  return out;
}

/** Every plugin every configured marketplace offers, with an installed flag. */
export async function readCatalogPlugins(installedIds: ReadonlySet<string>): Promise<PluginCatalogItem[]> {
  const registry = await readJson<MarketplaceRegistry>(getMarketplacesRegistryPath());
  const entries = Array.isArray(registry?.marketplaces) ? registry.marketplaces : [];
  const cache = catalogCache();
  const out: PluginCatalogItem[] = [];
  for (const entry of entries) {
    const marketplace = typeof entry.name === 'string' ? entry.name : '';
    const catalogPath = typeof entry.catalogPath === 'string' ? entry.catalogPath : '';
    if (!marketplace || !catalogPath) continue;
    let size = 0;
    try {
      size = (await Bun.file(catalogPath).stat()).size;
    } catch {
      continue;
    }
    const cached = cache.get(catalogPath);
    let plugins: PluginCatalogItem[];
    if (cached && cached.size === size && Date.now() - cached.at < CATALOG_CACHE_TTL_MS) {
      plugins = cached.plugins;
    } else {
      plugins = await parseCatalog(catalogPath, marketplace);
      cache.set(catalogPath, { at: Date.now(), size, plugins });
    }
    for (const plugin of plugins) {
      out.push({ ...plugin, installed: installedIds.has(`${plugin.name}@${marketplace}`) });
    }
  }
  return out;
}

async function parseCatalog(catalogPath: string, marketplace: string): Promise<PluginCatalogItem[]> {
  const catalog = await readJson<CatalogFile>(catalogPath);
  if (!Array.isArray(catalog?.plugins)) return [];
  const out: PluginCatalogItem[] = [];
  for (const raw of catalog.plugins as Array<Record<string, unknown>>) {
    const name = typeof raw?.name === 'string' ? raw.name : '';
    if (!name) continue;
    out.push({
      name,
      marketplace,
      description: typeof raw.description === 'string' ? raw.description : '',
      ...(typeof raw.category === 'string' ? { category: raw.category } : {}),
      ...(typeof raw.homepage === 'string' ? { homepage: raw.homepage } : {}),
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
      installed: false,
    });
  }
  return out;
}
