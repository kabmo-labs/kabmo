/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Validation for panel-plugin manifests and marketplace catalogs.
 *
 * Pure: every function takes an already-parsed JSON value and a root path, and
 * returns either a normalized value or the sentence explaining why it was
 * refused. Nothing here touches the filesystem, which is what makes the rules
 * testable without a fixture tree — and the rules are the part that matters,
 * because every one of them is a refusal that would otherwise be silent.
 *
 * A manifest no longer declares PANELS. A plugin's UI is what its bundle
 * registers when it loads, so the manifest carries only what the HOST needs
 * before the code runs: an identity, an icon, and the bundle to import. Slot
 * titles and positions come from the registration — which is also why the
 * server cannot list a plugin's panels and the client lists what loaded.
 */

import type {
  PanelMarketplaceManifest,
  PanelMarketplacePluginEntry,
  PanelPluginManifest,
} from '@/shared/types';
import type { PluginSettingDefinition } from '@ompchamber/plugin-sdk';
import { isRecord } from '@/shared/lib/util/guards';
import { isValidRange } from '@/shared/lib/updates/semver';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';

/** An id segment: what a plugin id may look like. */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Parse a plugin manifest body.
 *
 * `app` and `server` name BUILT files (`dist/app.js`, `dist/server.js`), not
 * sources, and each must resolve inside the plugin's own directory: a value
 * becomes a filesystem read on the asset route, so an absolute path or a `../`
 * segment would turn one plugin's manifest into a read of any file the server
 * can open. `icon` is held to the same rule for the same reason.
 *
 * `engines` is where the honesty lives: a range that is NOT a range is a
 * refusal here rather than a pass, because a range the host cannot read would
 * otherwise be silently ignored and the plugin admitted on a requirement
 * nobody checked. Whether the range is SATISFIED is a separate question — this
 * module owns the shape, the scan owns the comparison.
 */
export function toManifest(raw: unknown, root: string): PanelPluginManifest | { error: string } {
  if (!isRecord(raw)) return { error: 'manifest is not an object' };
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const version = trimmed(raw.version);
  const app = trimmed(raw.app);
  const server = trimmed(raw.server);
  if (!id || !ID_RE.test(id)) return { error: `manifest id ${JSON.stringify(raw.id)} is missing or invalid` };
  if (!name) return { error: 'manifest has no name' };
  if (!version) return { error: 'manifest has no version' };
  // A plugin must declare something the host can run. A server-only plugin is
  // the reason this is not simply "no app".
  if (!app && !server) return { error: 'manifest has no "app" bundle or "server" entry' };
  if (app && !resolveInsideRoot(root, app)) return { error: `manifest app "${app}" escapes the plugin directory` };
  if (server && !resolveInsideRoot(root, server)) {
    return { error: `manifest server "${server}" escapes the plugin directory` };
  }

  const icon = trimmed(raw.icon);
  if (icon && !resolveInsideRoot(root, icon)) {
    return { error: `manifest icon "${icon}" escapes the plugin directory` };
  }

  const readme = trimmed(raw.readme);
  if (readme && !resolveInsideRoot(root, readme)) {
    return { error: `manifest readme "${readme}" escapes the plugin directory` };
  }

  const branding = isRecord(raw.branding) ? trimmed(raw.branding.icon) : undefined;
  const engines = toEngines(raw.engines);
  if ('error' in engines) return engines;
  const capabilities = toCapabilities(raw.capabilities);
  if ('error' in capabilities) return capabilities;
  const settings = toSettings(raw.settings);
  if ('error' in settings) return settings;

  return {
    id,
    name,
    version,
    ...(app ? { app } : {}),
    ...(server ? { server } : {}),
    ...(settings.value ? { settings: settings.value } : {}),
    ...(engines.value ? { engines: engines.value } : {}),
    ...(capabilities.value ? { capabilities: capabilities.value } : {}),
    ...(trimmed(raw.description) ? { description: trimmed(raw.description) } : {}),
    ...(trimmed(raw.homepage) ? { homepage: trimmed(raw.homepage) } : {}),
    ...(icon ? { icon } : {}),
    ...(readme ? { readme } : {}),
    ...(branding ? { branding: { icon: branding } } : {}),
  };
}

/**
 * Validate `engines`: an optional object of the two host keys, each a range the
 * module can read. An unknown key is a refusal rather than a silent ignore —
 * `engines.ompchamberSdk` is a typo that would otherwise remove the requirement
 * the author meant to state.
 */
function toEngines(
  raw: unknown,
): { value?: { ompchamber?: string; pluginSdk?: string } } | { error: string } {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return { error: `manifest engines ${JSON.stringify(raw)} is not an object` };
  const value: { ompchamber?: string; pluginSdk?: string } = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (key !== 'ompchamber' && key !== 'pluginSdk') {
      return { error: `manifest engines has an unknown key ${JSON.stringify(key)}` };
    }
    const range = trimmed(entry);
    if (!range) return { error: `manifest engines.${key} ${JSON.stringify(entry)} is not a version range` };
    if (!isValidRange(range)) {
      return { error: `manifest engines.${key} "${range}" is not a valid version range` };
    }
    value[key] = range;
  }
  return Object.keys(value).length > 0 ? { value } : {};
}

/** Validate `capabilities`: an optional array of non-empty capability names. */
function toCapabilities(raw: unknown): { value?: string[] } | { error: string } {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) return { error: `manifest capabilities ${JSON.stringify(raw)} is not an array` };
  const value: string[] = [];
  for (const entry of raw) {
    const capability = trimmed(entry);
    if (!capability) return { error: `manifest capabilities has an invalid entry ${JSON.stringify(entry)}` };
    value.push(capability);
  }
  return value.length > 0 ? { value } : {};
}

/** Whether a value is one of the three primitives a setting may hold. */
function isSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Whether a value is one of the three setting types the host can render. */
function isSettingType(value: unknown): value is PluginSettingDefinition['type'] {
  return value === 'string' || value === 'number' || value === 'boolean';
}

/**
 * Validate `settings`: an optional map of setting name → definition.
 *
 * Only the fields the host renders or validates are read, and each is checked
 * rather than copied: a definition the host cannot render is worse than a
 * refused one, because the pane would draw a form that writes a value the
 * plugin's own contract says is the wrong shape.
 */
function toSettings(raw: unknown): { value?: Record<string, PluginSettingDefinition> } | { error: string } {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return { error: `manifest settings ${JSON.stringify(raw)} is not an object` };
  const value: Record<string, PluginSettingDefinition> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) return { error: `manifest settings "${key}" is not an object` };
    const type = entry.type;
    if (!isSettingType(type)) {
      return { error: `manifest settings "${key}" has an unknown type ${JSON.stringify(type)}` };
    }
    const label = trimmed(entry.label);
    if (!label) return { error: `manifest settings "${key}" has no label` };
    const description = trimmed(entry.description);
    const fallback = entry.default;
    if (fallback !== undefined && !isSettingValue(fallback)) {
      return { error: `manifest settings "${key}" has an invalid default ${JSON.stringify(fallback)}` };
    }
    const secret = entry.secret;
    if (secret !== undefined && typeof secret !== 'boolean') {
      return { error: `manifest settings "${key}" has an invalid secret ${JSON.stringify(secret)}` };
    }
    value[key] = {
      type,
      label,
      ...(description ? { description } : {}),
      ...(fallback !== undefined ? { default: fallback } : {}),
      ...(secret !== undefined ? { secret } : {}),
    };
  }
  return Object.keys(value).length > 0 ? { value } : {};
}

/**
 * Parse a marketplace catalog.
 *
 * A catalog is optional metadata: its job is descriptions and grouping for
 * plugins that are found on disk anyway, so a catalog that is absent or has no
 * `plugins` array is a valid, empty catalog rather than an error. What is NOT
 * optional is a catalog entry's `source` — it is the key that binds an entry to
 * a directory, and an entry whose source escapes the marketplace root would let
 * the catalog point at anything.
 */
export function toMarketplaceCatalog(raw: unknown, root: string): PanelMarketplaceManifest | { error: string } {
  if (!isRecord(raw)) return { error: 'marketplace.json is not an object' };
  const entries: PanelMarketplacePluginEntry[] = [];
  const rawPlugins = raw.plugins;
  if (rawPlugins !== undefined) {
    if (!Array.isArray(rawPlugins)) return { error: 'marketplace.json "plugins" must be an array' };
    for (const item of rawPlugins) {
      if (!isRecord(item)) return { error: 'a marketplace plugin entry is not an object' };
      const name = trimmed(item.name);
      const source = trimmed(item.source);
      if (!name) return { error: 'a marketplace plugin entry has no name' };
      if (!source) return { error: `marketplace plugin "${name}" has no source` };
      if (!resolveInsideRoot(root, source)) {
        return { error: `marketplace plugin "${name}" source "${source}" escapes the marketplace directory` };
      }
      entries.push({
        name,
        source,
        description: trimmed(item.description),
        version: trimmed(item.version),
        category: trimmed(item.category),
      });
    }
  }
  const owner = isRecord(raw.owner) ? { name: trimmed(raw.owner.name) } : undefined;
  return {
    name: trimmed(raw.name),
    description: trimmed(raw.description),
    ...(owner ? { owner } : {}),
    plugins: entries,
  };
}
