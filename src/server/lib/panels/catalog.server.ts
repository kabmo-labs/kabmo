/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading and writing the marketplace catalog.
 *
 * Every write is a read-modify-write of `marketplace.json`, because the file
 * carries the marketplace's own name, description and every earlier entry —
 * rewriting it from a template would drop them. Split out of the installer so
 * the two directions live together: the install appends an entry, the remove
 * drops one, and the repair drops one whose directory is already gone. They
 * share one parse and one write, which is what keeps them agreeing about the
 * shape of the file.
 *
 * The catalog and the directories are independent, and the scan relies on it:
 * a plugin present under `plugins/` and absent from the catalog still loads, and
 * a catalog entry naming a directory that is not there is reported. Nothing here
 * touches a plugin directory — deleting files is `removePanelPlugin`'s job.
 */

import { isRecord } from '@kabmo-labs/kabmo-guards';
import {
  KABMO_PLUGIN_REPO_PREFIX,
  parseGithubPluginRepo,
  pluginNameFromRepo,
  pluginRepoNameError,
  samePluginRepo,
} from '@/shared/lib/panels/plugin-repo';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';
import { pathExists } from '@kabmo-labs/kabmo-omp/paths';
import {
  getMarketplaceCatalogPath,
  getMarketplaceDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';

/**
 * Read the catalog body, or an empty object when it is absent or unparseable.
 *
 * A missing file is not a fault here: an install into a marketplace whose
 * catalog was deleted should still register its plugin, and the alternative —
 * refusing — would leave a working plugin the scan finds but the catalog cannot
 * describe. A file that exists and cannot be parsed is a different answer, and
 * the write below replaces it rather than silently keeping it broken.
 */
async function readCatalogBody(): Promise<Record<string, unknown>> {
  const catalogPath = getMarketplaceCatalogPath();
  if (!(await pathExists(catalogPath))) return {};
  try {
    const parsed: unknown = await Bun.file(catalogPath).json();
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Write the catalog body, reporting a write failure as a value. */
async function writeCatalogBody(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await Bun.write(getMarketplaceCatalogPath(), JSON.stringify(body, null, 2) + '\n');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Append an entry to the catalog, preserving everything already in it.
 *
 * Idempotent by NAME, which is the key an install writes (the manifest id). A
 * hand-written entry may carry any label, and that is why the prune below keys
 * on the source path instead — the two operations address the entry by the thing
 * each of them actually knows.
 */
export async function appendCatalogEntry(entry: {
  name: string;
  source: string;
  description?: string;
  version?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const body = await readCatalogBody();
  const existing: unknown[] = Array.isArray(body.plugins) ? body.plugins : [];
  const already = existing.some((item) => isRecord(item) && item.name === entry.name);
  const plugins = already ? existing : [...existing, { ...entry, category: 'installed' }];
  return writeCatalogBody({ ...body, plugins });
}

/**
 * Drop the catalog entry whose `source` is `source`, keeping the rest.
 *
 * Keyed on the source path rather than the name, because the name an install
 * writes is the manifest id while a hand-written entry may use any label — and
 * it is the path that the scan resolves.
 *
 * An entry that is not there is a success, not a miss: the caller asked for the
 * file to stop naming a path, and it does not.
 */
export async function pruneCatalogEntry(source: string): Promise<{ ok: boolean; error?: string }> {
  const catalogPath = getMarketplaceCatalogPath();
  if (!(await pathExists(catalogPath))) return { ok: true };

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await Bun.file(catalogPath).json();
    if (!isRecord(parsed)) return { ok: true };
    body = parsed;
  } catch {
    return { ok: false, error: 'marketplace.json is not valid JSON; its entry was left in place.' };
  }

  const existing: unknown[] = Array.isArray(body.plugins) ? body.plugins : [];
  const kept = existing.filter((item) => !(isRecord(item) && item.source === source));
  if (kept.length === existing.length) return { ok: true };
  return writeCatalogBody({ ...body, plugins: kept });
}

/**
 * Forget a catalog entry whose directory is already gone.
 *
 * This is the repair for the one rejection the pane cannot otherwise clear. A
 * directory removed by anything other than `removePanelPlugin` — a hand `rm`, a
 * cleanup script, an interrupted install — leaves the catalog claiming an
 * install that is not there. The rejection row is honest, but until now it was
 * also permanent: the only way to clear it was to edit `marketplace.json` by
 * hand.
 *
 * Deliberately does NOT touch the directory. `removePanelPlugin` is the action
 * that deletes files, and it refuses when there are none; this is the narrow one
 * for "the files are already gone, drop the record". A directory that reappears
 * is picked up by the next scan regardless, because a directory is what makes a
 * plugin exist.
 *
 * `source` is validated against the marketplace root for the same reason the
 * catalog's own parse validates it: it arrives from a browser and is compared
 * verbatim against every entry's `source`, so an unvalidated value could address
 * an entry outside the marketplace — or, worse, be read as a path by a future
 * caller that trusts it.
 */
export async function forgetCatalogEntry(source: string): Promise<{ ok: boolean; error?: string }> {
  if (!source.trim()) return { ok: false, error: 'A catalog source is required.' };
  if (!resolveInsideRoot(getMarketplaceDir(), source)) {
    return { ok: false, error: `"${source}" does not name an entry inside the marketplace.` };
  }
  const result = await pruneCatalogEntry(source);
  invalidatePanelScan();
  return result;
}

/**
 * Register a GitHub plugin repository in `marketplace.json`.
 *
 * One write: the `registries` array. It is the durable registration — the pane's
 * list, and what a later boot re-reads — while what the repository OFFERS lives
 * in the refresh cache (`registries.server.ts`). Keeping the two apart is what
 * lets a registration survive GitHub being unreachable: the row stays, with the
 * reason, instead of pretending the repository published nothing.
 *
 * Idempotent by repository, so clicking Add again after a failure does not
 * accumulate rows.
 */
export async function registerCatalogRegistry(
  url: string,
  displayName?: string,
): Promise<{ ok: true; repo: string } | { ok: false; error: string }> {
  const repo = parseGithubPluginRepo(url);
  if (!repo) return { ok: false, error: `"${url}" is not a GitHub repository.` };
  const nameError = pluginRepoNameError(url);
  if (nameError) return { ok: false, error: nameError };
  if (!pluginNameFromRepo(url)) {
    return { ok: false, error: `"${url}" does not name a plugin after the "${KABMO_PLUGIN_REPO_PREFIX}" prefix.` };
  }

  const canonical = `${repo.owner}/${repo.repo}`;
  const body = await readCatalogBody();
  const registries: unknown[] = Array.isArray(body.registries) ? body.registries : [];
  const alreadyRegistered = registries.some(
    (item) => isRecord(item) && typeof item.repo === 'string' && samePluginRepo(item.repo, url),
  );
  if (!alreadyRegistered) {
    registries.push({ repo: canonical, ...(displayName?.trim() ? { name: displayName.trim() } : {}) });
  }

  const written = await writeCatalogBody({ ...body, registries });
  if (!written.ok) return { ok: false, error: written.error ?? 'marketplace.json could not be written.' };
  invalidatePanelScan();
  return { ok: true, repo: canonical };
}

/**
 * Drop a registration. The refresh cache is pruned by the caller after this
 * succeeds, so the offers disappear in the same answer.
 *
 * A repository that is not registered is a success: the caller asked for the
 * file to stop naming it, and it does.
 */
export async function pruneCatalogRegistry(repo: string): Promise<{ ok: boolean; error?: string }> {
  if (!repo.trim()) return { ok: false, error: 'A repository is required.' };
  const catalogPath = getMarketplaceCatalogPath();
  if (!(await pathExists(catalogPath))) return { ok: true };

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await Bun.file(catalogPath).json();
    if (!isRecord(parsed)) return { ok: true };
    body = parsed;
  } catch {
    return { ok: false, error: 'marketplace.json is not valid JSON; its entry was left in place.' };
  }

  const registries: unknown[] = Array.isArray(body.registries) ? body.registries : [];
  const kept = registries.filter(
    (item) => !(isRecord(item) && typeof item.repo === 'string' && samePluginRepo(item.repo, repo)),
  );
  if (kept.length === registries.length) return { ok: true };

  const written = await writeCatalogBody({ ...body, registries: kept });
  if (!written.ok) return { ok: false, error: written.error };
  invalidatePanelScan();
  return { ok: true };
}
