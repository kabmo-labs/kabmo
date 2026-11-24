/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The on-disk cache of what each registered repository offered last time it
 * answered.
 *
 * A separate file from `marketplace.json` on purpose: the catalog holds the
 * REGISTRATION (what the user added, and the only thing that must survive), while
 * this holds the RESULT of reading it — descriptions, versions, the reason a read
 * failed. Keeping them apart is what lets a registration outlive GitHub being
 * unreachable, and it keeps a network result out of the file a user may edit by
 * hand.
 *
 * Every read is total: a missing file, a malformed file and a file written by an
 * older shape all answer an empty cache rather than throwing. The cache is a
 * convenience — the registration is the truth — so a corrupt one costs a refresh,
 * never a pane that cannot render.
 */

import { join } from 'path';
import type { PanelPluginAuthor } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { parseGithubPluginRepo } from '@/shared/lib/panels/plugin-repo';
import { readJsonBody } from '@/server/lib/panels/files.server';
import { getMarketplaceDir } from '@/server/lib/panels/registry.server';

export interface RegistryOffer {
  name: string;
  url: string;
  version?: string;
  description?: string;
  author?: PanelPluginAuthor;
  homepage?: string;
}

export interface RegistryCacheEntry {
  /** ISO time of the last attempt, successful or not. */
  fetchedAt: string;
  /** Why the last refresh failed. The previous offers are kept. */
  error?: string;
  /** Entries the catalog named that this installer cannot offer, and why. */
  warning?: string;
  /** The catalog's own description, for the registration row. */
  description?: string;
  offers: RegistryOffer[];
}

export interface RegistryCache {
  version: 1;
  registries: Record<string, RegistryCacheEntry>;
}

/** `<data>/marketplace/registries.json` — the refresh cache, next to the catalog. */
export function getRegistryCachePath(): string {
  return join(getMarketplaceDir(), 'registries.json');
}

/** The cache key for a repository: `owner/repo`, lowercased. */
export function registryCacheKey(repo: string): string {
  const parsed = parseGithubPluginRepo(`https://github.com/${repo}`);
  return parsed ? `${parsed.owner}/${parsed.repo}`.toLowerCase() : repo.toLowerCase();
}

/** The clone URL a registration's `owner/repo` names. */
export function registryRepoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

export async function readRegistryCache(): Promise<RegistryCache> {
  const read = await readJsonBody(getRegistryCachePath());
  if (read.kind !== 'body' || !isRecord(read.value)) return { version: 1, registries: {} };
  const raw = isRecord(read.value.registries) ? read.value.registries : {};
  const registries: Record<string, RegistryCacheEntry> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !Array.isArray(entry.offers)) continue;
    registries[key.toLowerCase()] = {
      fetchedAt: typeof entry.fetchedAt === 'string' ? entry.fetchedAt : '',
      ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      ...(typeof entry.warning === 'string' ? { warning: entry.warning } : {}),
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      offers: entry.offers
        .filter((offer): offer is Record<string, unknown> => isRecord(offer))
        .map((offer) => ({
          name: typeof offer.name === 'string' ? offer.name : '',
          url: typeof offer.url === 'string' ? offer.url : '',
          ...(typeof offer.version === 'string' ? { version: offer.version } : {}),
          ...(typeof offer.description === 'string' ? { description: offer.description } : {}),
          ...(isRecord(offer.author) && typeof offer.author.name === 'string'
            ? { author: { name: offer.author.name } }
            : {}),
          ...(typeof offer.homepage === 'string' ? { homepage: offer.homepage } : {}),
        }))
        .filter((offer) => offer.name && offer.url),
    };
  }
  return { version: 1, registries };
}

export async function writeRegistryCache(cache: RegistryCache): Promise<void> {
  await Bun.write(getRegistryCachePath(), JSON.stringify(cache, null, 2) + '\n');
}
