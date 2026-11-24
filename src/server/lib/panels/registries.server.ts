/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitHub repositories registered as panel-plugin sources — the READ side.
 *
 * `marketplace.json` can name repositories rather than hold their code, so a
 * plugin author publishes in their own repository and still appears in the
 * pane's Available grid. The file records only the REGISTRATION; what each
 * repository offers is read from GitHub and cached (`registry-refresh.server.ts`
 * writes that cache), because a scan must never depend on the network — the
 * pane's first paint would be a clone timeout on a bad connection.
 *
 * The naming rule is the point of the whole feature: an external GitHub plugin
 * repository is named `kabmo-plugins-<plugin>` (see
 * `shared/lib/panels/plugin-repo.ts`). The plugin it publishes is named
 * whatever its manifest says; the prefix belongs to the repository only — which
 * is why a bare plugin name resolves to a URL here, and why installing never
 * needs the prefix.
 */

import type { PanelCatalogEntry, PanelMarketplaceRegistryEntry, PanelPluginSource } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { pluginNameFromRepo, pluginRepoKey } from '@/shared/lib/panels/plugin-repo';
import { readJsonBody } from '@/server/lib/panels/files.server';
import { toMarketplaceRegistries } from '@/server/lib/panels/marketplace-catalog.server';
import { getMarketplaceCatalogPath } from '@/server/lib/panels/registry.server';
import {
  readRegistryCache,
  registryCacheKey,
  registryRepoUrl,
  type RegistryOffer,
} from '@/server/lib/panels/registry-cache.server';

/**
 * The offer a registered repository publishes under `name`.
 *
 * This is what lets the install field accept a PLUGIN NAME (`kanban`) instead of
 * a URL: the prefix belongs to the repository, so the name a user types is the
 * plugin's own. The lookup reads the cache — the same offers the pane lists — so
 * a name that is on screen is a name that installs.
 */
export async function findRegistryOffer(name: string): Promise<RegistryOffer | undefined> {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const cache = await readRegistryCache();
  for (const entry of Object.values(cache.registries)) {
    const match = entry.offers.find(
      (offer) => offer.name.toLowerCase() === needle || pluginNameFromRepo(offer.url) === needle,
    );
    if (match) return match;
  }
  return undefined;
}

/** The registrations `marketplace.json` holds, validated; an empty list when unreadable. */
export async function readRegistryRegistrations(): Promise<PanelMarketplaceRegistryEntry[]> {
  const read = await readJsonBody(getMarketplaceCatalogPath());
  if (read.kind !== 'body' || !isRecord(read.value)) return [];
  const parsed = toMarketplaceRegistries(read.value.registries);
  return 'error' in parsed ? [] : parsed.value;
}

/**
 * The offers every registered repository makes, as catalog entries.
 *
 * `installedRepos` is what keeps a registered offer from reappearing after its
 * plugin is installed under a manifest id that differs from the name the
 * repository name suggests: the clone's own origin is the identity that matched
 * at registration time.
 */
export async function readRegistryOffers(
  installed: ReadonlySet<string>,
  installedRepos: ReadonlySet<string>,
): Promise<PanelCatalogEntry[]> {
  const [registrations, cache] = await Promise.all([readRegistryRegistrations(), readRegistryCache()]);
  const offers: PanelCatalogEntry[] = [];
  for (const registration of registrations) {
    const entry = cache.registries[registryCacheKey(registration.repo)];
    if (!entry) continue;
    for (const offer of entry.offers) {
      offers.push({
        pluginId: offer.name,
        name: offer.name,
        version: offer.version ?? '',
        ...(offer.description ? { description: offer.description } : {}),
        ...(offer.author ? { author: offer.author } : {}),
        ...(offer.homepage ? { homepage: offer.homepage } : {}),
        origin: 'git',
        url: offer.url,
        installed: installed.has(offer.name) || installedRepos.has(pluginRepoKey(offer.url)),
      });
    }
  }
  return offers;
}

/** The registrations plus their cached state, for the payload. */
export async function readRegistrySources(): Promise<PanelPluginSource[]> {
  const [registrations, cache] = await Promise.all([readRegistryRegistrations(), readRegistryCache()]);
  return registrations.map((registration) => {
    const entry = cache.registries[registryCacheKey(registration.repo)];
    const url = registryRepoUrl(registration.repo);
    const description = registration.description ?? entry?.description;
    return {
      repo: registration.repo,
      url,
      name: registration.name ?? pluginNameFromRepo(url) ?? registration.repo,
      ...(description ? { description } : {}),
      ...(entry?.fetchedAt ? { fetchedAt: entry.fetchedAt } : {}),
      ...(entry?.error ? { error: entry.error } : {}),
      ...(entry?.warning ? { warning: entry.warning } : {}),
      pluginCount: entry?.offers.length ?? 0,
    };
  });
}
