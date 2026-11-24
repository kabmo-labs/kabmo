/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Parsing a marketplace catalog (`marketplace.json`).
 *
 * Pure: an already-parsed JSON value and the marketplace root in, a normalized
 * catalog or the sentence explaining the refusal out. Split from `manifest.ts`
 * when the registered-repository rules pushed that module past its file ceiling,
 * and the split is along the seam that was already there — a plugin's own
 * manifest and a marketplace's catalog are different documents read by
 * different code.
 *
 * A catalog is optional metadata: its job is descriptions and grouping for
 * plugins that are found on disk anyway, so a catalog that is absent or has no
 * `plugins` array is a valid, empty catalog rather than an error. What is NOT
 * optional is a catalog entry's `source` — it is the key that binds an entry to
 * a directory, and an entry whose source escapes the marketplace root would let
 * the catalog point at anything.
 *
 * A `source` may be a REMOTE git URL instead of a path. That entry is an OFFER
 * with no directory behind it: nothing is scanned for it and nothing is built
 * until the user installs it, at which point the installer clones it exactly as
 * it clones a URL typed into the form. The escape check does not apply — there
 * is no root to escape — so the two shapes are separated before it runs, which
 * is what stops a `git@host:repo` string from being read as a relative path.
 *
 * A remote GitHub source must name a repository that follows the ecosystem rule
 * (`kabmo-plugins-<plugin>`); the refusal says so at parse time rather than at
 * clone time, when the user has already waited for the network.
 */

import type {
  PanelMarketplaceManifest,
  PanelMarketplacePluginEntry,
  PanelMarketplaceRegistryEntry,
} from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { isRemoteGitUrl } from '@/shared/lib/git/url';
import {
  normalisePluginSpec,
  parseGithubPluginRepo,
  pluginRepoNameError,
} from '@/shared/lib/panels/plugin-repo';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';
import { toAuthor, trimmed } from '@/server/lib/panels/manifest';

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
      const remote = isRemoteGitUrl(source);
      if (!remote && !resolveInsideRoot(root, source)) {
        return { error: `marketplace plugin "${name}" source "${source}" escapes the marketplace directory` };
      }
      // The naming rule is enforced where an entry NAMES a repository, so a
      // non-compliant one is refused with the sentence that says what to rename.
      const nameError = remote ? pluginRepoNameError(source) : null;
      if (nameError) return { error: `marketplace plugin "${name}": ${nameError}` };
      const author = toAuthor(item.author);
      entries.push({
        name,
        source,
        description: trimmed(item.description),
        version: trimmed(item.version),
        category: trimmed(item.category),
        ...(author ? { author } : {}),
        ...(trimmed(item.homepage) ? { homepage: trimmed(item.homepage) } : {}),
        ...(remote ? { remote: true } : {}),
      });
    }
  }
  const registries = toMarketplaceRegistries(raw.registries);
  if ('error' in registries) return { error: registries.error };
  const owner = isRecord(raw.owner) ? { name: trimmed(raw.owner.name) } : undefined;
  return {
    name: trimmed(raw.name),
    description: trimmed(raw.description),
    ...(owner ? { owner } : {}),
    plugins: entries,
    ...(registries.value.length > 0 ? { registries: registries.value } : {}),
  };
}

/**
 * Parse a catalog's `registries`: the GitHub repositories it publishes from.
 *
 * Registration is GitHub-only on purpose. A registered repository is DISCOVERED
 * by its name (`kabmo-plugins-<plugin>`), so a self-hosted forge or a local path
 * has nothing to be checked against — and an unvalidated entry would be a second
 * way into the install path that skips the rule the install itself enforces.
 *
 * A `repo` may be the `owner/repo` shorthand, which is what the pane's field
 * accepts; the parsed value is the canonical `owner/repo`.
 */
export function toMarketplaceRegistries(
  raw: unknown,
): { value: PanelMarketplaceRegistryEntry[] } | { error: string } {
  if (raw === undefined) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'marketplace.json "registries" must be an array' };
  const out: PanelMarketplaceRegistryEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return { error: 'a marketplace registry entry is not an object' };
    const written = trimmed(item.repo);
    if (!written) return { error: 'a marketplace registry entry has no repo' };
    const url = normalisePluginSpec(written);
    if (!url) return { error: `marketplace registry "${written}" is not a git source` };
    const repo = parseGithubPluginRepo(url);
    if (!repo) return { error: `marketplace registry "${written}" is not a GitHub repository` };
    const nameError = pluginRepoNameError(url);
    if (nameError) return { error: `marketplace registry "${written}": ${nameError}` };
    const name = trimmed(item.name);
    const description = trimmed(item.description);
    out.push({
      repo: `${repo.owner}/${repo.repo}`,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    });
  }
  return { value: out };
}
