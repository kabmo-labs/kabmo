/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a registered repository from GitHub, and caching what it offers.
 *
 * The cache layer is `registry-cache.server.ts`; this module is the network half
 * plus the parse of what a repository publishes. Split from the read side
 * (`registries.server.ts`) because the two run at different times and fail
 * differently: a scan reads the cache and must never touch the network, while a
 * refresh is an explicit, bounded round trip whose failures are VALUES — the
 * registration stays, the row says why.
 *
 * A repository answers in one of two shapes:
 *
 * - it publishes a catalog (`marketplace.json`, or `.omp-plugin/marketplace.json`
 *   in omp's own convention) whose entries name REMOTE git URLs — an index of
 *   plugins living in their own repositories;
 * - it publishes nothing, or nothing installable, and the repository itself IS
 *   the plugin — the ordinary case for a repository named after one plugin.
 *
 * Relative sources inside a registered repository cannot be offered: installing
 * one would need a clone of a subdirectory, and `installPanelPluginFromGit`
 * clones whole repositories. They are reported as a warning rather than
 * silently dropped, and the repository-as-plugin fallback still gives the
 * reader something to install.
 */

import type { PanelPluginAuthor } from '@/shared/types';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import { isRemoteGitUrl } from '@/shared/lib/git/url';
import {
  parseGithubPluginRepo,
  pluginNameFromRepo,
  pluginRepoNameError,
} from '@/shared/lib/panels/plugin-repo';
import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import {
  readRegistryCache,
  registryCacheKey,
  registryRepoUrl,
  writeRegistryCache,
  type RegistryCacheEntry,
  type RegistryOffer,
} from '@/server/lib/panels/registry-cache.server';
import { readRegistryRegistrations } from '@/server/lib/panels/registries.server';

/** A refresh is one HTTP request per candidate; a hung host must not hold the pane. */
const FETCH_TIMEOUT_MS = 10_000;

/** The catalog paths a registered repository may publish, in the order tried. */
const CATALOG_CANDIDATES = ['marketplace.json', '.omp-plugin/marketplace.json'];

/** The offer a repository makes when it publishes no installable catalog of its own. */
function repositoryOffer(repo: string, description?: string): RegistryOffer | null {
  const url = registryRepoUrl(repo);
  const name = pluginNameFromRepo(url);
  if (!name) return null;
  return { name, url, ...(description ? { description } : {}) };
}

/**
 * The offers one repository's catalog names.
 *
 * Only REMOTE sources are installable, because the installer clones a whole
 * repository. Everything else is collected into one sentence so the row can say
 * why a listed plugin is missing instead of showing a shorter list with no
 * explanation.
 */
function offersFromCatalog(value: unknown, repo: string): { offers: RegistryOffer[]; warning?: string } {
  if (!isRecord(value)) return { offers: [] };
  const skips: string[] = [];
  const offers: RegistryOffer[] = [];
  const plugins = Array.isArray(value.plugins) ? value.plugins : [];
  for (const item of plugins) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const source = typeof item.source === 'string' ? item.source.trim() : '';
    if (!name || !source) continue;
    if (!isRemoteGitUrl(source)) {
      skips.push(`"${name}" names a directory inside ${repo}, which a clone cannot install`);
      continue;
    }
    const nameError = pluginRepoNameError(source);
    if (nameError) {
      skips.push(`"${name}": ${nameError}`);
      continue;
    }
    const author: PanelPluginAuthor | undefined =
      isRecord(item.author) && typeof item.author.name === 'string' ? { name: item.author.name } : undefined;
    offers.push({
      name,
      url: source,
      ...(typeof item.version === 'string' ? { version: item.version } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(author ? { author } : {}),
      ...(typeof item.homepage === 'string' ? { homepage: item.homepage } : {}),
    });
  }
  const warning = skips.length > 0 ? { warning: skips.join('; ') } : {};
  if (offers.length > 0) return { offers, ...warning };
  const fallback = repositoryOffer(repo, typeof value.description === 'string' ? value.description : undefined);
  return { offers: fallback ? [fallback] : [], ...warning };
}

type FetchOutcome = { kind: 'ok'; value: unknown } | { kind: 'missing' } | { kind: 'error'; error: string };

async function fetchJson(url: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'error', error: `GitHub answered ${response.status} for ${url}` };
    return { kind: 'ok', value: await response.json() };
  } catch (error) {
    return { kind: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read one repository now, keeping its previous offers when the read fails. */
async function fetchRegistryEntry(repo: string, previous: RegistryCacheEntry | undefined): Promise<RegistryCacheEntry> {
  const fetchedAt = new Date().toISOString();
  for (const candidate of CATALOG_CANDIDATES) {
    const outcome = await fetchJson(`https://raw.githubusercontent.com/${repo}/HEAD/${candidate}`);
    if (outcome.kind === 'missing') continue;
    if (outcome.kind === 'error') {
      return { fetchedAt, error: outcome.error, offers: previous?.offers ?? [] };
    }
    const parsed = offersFromCatalog(outcome.value, repo);
    return {
      fetchedAt,
      offers: parsed.offers,
      ...(parsed.warning ? { warning: parsed.warning } : {}),
      ...(isRecord(outcome.value) && typeof outcome.value.description === 'string'
        ? { description: outcome.value.description }
        : {}),
    };
  }
  // No catalog at either path: the repository itself is the plugin.
  const offer = repositoryOffer(repo);
  return { fetchedAt, offers: offer ? [offer] : [] };
}

/**
 * Refresh one registered repository and cache the result.
 *
 * The registration survives a failure — that is the difference between "GitHub
 * is unreachable" and "the user removed this source". The returned error is the
 * same sentence the row shows.
 */
export async function refreshPluginRegistry(repo: string): Promise<{ ok: boolean; error?: string }> {
  const url = registryRepoUrl(repo);
  const parsed = parseGithubPluginRepo(url);
  if (!parsed) return { ok: false, error: `"${repo}" is not a GitHub repository.` };
  const nameError = pluginRepoNameError(url);
  if (nameError) return { ok: false, error: nameError };

  const canonical = `${parsed.owner}/${parsed.repo}`;
  const key = registryCacheKey(canonical);
  const cache = await readRegistryCache();
  const entry = await fetchRegistryEntry(canonical, cache.registries[key]);
  cache.registries[key] = entry;
  await writeRegistryCache(cache);
  invalidatePanelScan();
  return entry.error ? { ok: false, error: entry.error } : { ok: true };
}

/** Refresh every registration, or the one named. Registration failures are values. */
export async function refreshPluginRegistries(repo?: string): Promise<{ ok: boolean; errors: string[] }> {
  const targets = repo ? [repo] : (await readRegistryRegistrations()).map((entry) => entry.repo);
  const errors: string[] = [];
  // Sequential on purpose: one pass is already a fan-out of HTTP requests, and
  // GitHub rate-limits a burst from one address into an "unreachable" answer.
  for (const target of targets) {
    const result = await refreshPluginRegistry(target);
    // The repository is prefixed because a batch answers with one banner: a bare
    // "connect ETIMEDOUT" would not say WHICH registration failed.
    if (!result.ok) errors.push(`${target}: ${result.error ?? 'refresh failed'}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Forget a repository's cached offers — called after its registration is removed. */
export async function pruneRegistryCache(repo: string): Promise<void> {
  const cache = await readRegistryCache();
  const key = registryCacheKey(repo);
  if (!(key in cache.registries)) return;
  delete cache.registries[key];
  await writeRegistryCache(cache);
  invalidatePanelScan();
}
