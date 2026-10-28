/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Is a git-installed panel plugin behind its remote, and how does it get current?
 *
 * A plugin installed from a URL is a shallow clone in the working marketplace,
 * and nothing else in Kabmo knows where it came from — the catalog entry
 * names `plugins/<id>`, not the URL. The clone's own `origin` is therefore the
 * origin of record (read by `git-clone.server.ts`), and freshness is a COMMIT
 * comparison: a plugin repository publishes no releases, so "current" can only
 * mean the commit the working copy sits on against the commit the remote's HEAD
 * names.
 *
 * `git ls-remote` is the probe rather than a fetch. It asks the remote for one
 * ref and writes nothing — no refs, no objects, no FETCH_HEAD — so a check that
 * finds nothing to do costs a network round trip and leaves the clone exactly as
 * it was. Fetching to answer "is there anything new" would mutate the directory
 * the check is about, and on a repository that changed nothing it would rewrite
 * the shallow boundary for no reason.
 *
 * The update is a FETCH plus a hard reset, not a merge. A shallow clone shares
 * no ancestor with a commit fetched past its boundary, so `merge --ff-only`
 * refuses with "unrelated histories" — measured on a depth-1 clone advanced by
 * one commit. The plugin directory is Kabmo-owned rather than a branch a user
 * works on, so taking the remote's tree outright is what an update means; a
 * clone carrying local edits is REFUSED first, the same way Kabmo's own
 * updater refuses a dirty checkout rather than merging over it.
 */

import { join } from 'path';
import { gitRun, firstLine } from '@/server/lib/wiki/git';
import { pathExists } from '@/server/lib/omp/core/paths';
import { getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { readGitOrigin } from '@/server/lib/panels/git-clone.server';
import { readPluginManifest } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { isRecord } from '@/shared/lib/util/guards';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import type { PanelGitStatus } from '@/shared/types';

/** A ref lookup is one round trip; a slow remote must not hold a scan. */
const PROBE_TIMEOUT_MS = 15_000;
/** A fetch moves objects, so it gets a real budget — the clone's own is 120s. */
const FETCH_TIMEOUT_MS = 60_000;

/** A commit SHA as git prints it, or null for anything else. */
function asSha(value: string): string | null {
  const trimmed = value.trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed : null;
}

/**
 * The commit a clone's remote HEAD names, or a reason it could not be read.
 *
 * `ls-remote <origin> HEAD` rather than a URL: the origin is already configured
 * on the clone, so the credential (or the absence of one) is whatever that clone
 * already works with, and no second spelling of the same remote can disagree.
 */
async function probeRemoteHead(dir: string): Promise<{ sha: string | null; error?: string }> {
  const result = await gitRun(['ls-remote', 'origin', 'HEAD'], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
  if (result.failed) return { sha: null, error: 'the remote did not answer in time' };
  if (result.exitCode !== 0) {
    return { sha: null, error: firstLine(result.stderr) || `git ls-remote exited with code ${result.exitCode}` };
  }
  return { sha: asSha(result.stdout.split(/\s+/)[0] ?? '') };
}

/** The commit a clone's working copy is at, or null when it cannot be read. */
async function readLocalHead(dir: string): Promise<string | null> {
  const result = await gitRun(['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
  return result.exitCode === 0 ? asSha(result.stdout) : null;
}

/**
 * The version the remote's manifest declares, read at the commit just fetched.
 *
 * Requires `FETCH_HEAD` to be current — the caller fetches first, and only when
 * the clone is BEHIND, so an up-to-date clone pays no extra round trip. The two
 * files a manifest can live in are tried in the same order the scan uses
 * (`package.json`'s `kabmo`/`pi` key, then a standalone `kabmo.json`), through
 * the same `toManifest`, so the version shown is the one the install would
 * produce rather than a second parse of the same file.
 *
 * `undefined` when the remote's tree cannot be read — a repository whose
 * manifest sits in a subdirectory, a private remote that answered the ref but
 * not the blob. The card then shows the installed version alone; inventing one
 * would be worse than saying nothing.
 */
async function readRemoteVersion(dir: string): Promise<string | undefined> {
  for (const file of ['package.json', 'kabmo.json']) {
    const show = await gitRun(['show', `FETCH_HEAD:${file}`], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
    if (show.exitCode !== 0) continue;
    let body: unknown;
    try {
      body = JSON.parse(show.stdout);
    } catch {
      continue;
    }
    const record = isRecord(body) ? body : {};
    const raw = file === 'package.json' ? (record.kabmo ?? record.pi) : body;
    const manifest = toManifest(raw, dir);
    if ('error' in manifest) continue;
    return manifest.version;
  }
  return undefined;
}

/** Whether the clone has uncommitted work that an update would discard. */
async function isDirty(dir: string): Promise<boolean> {
  const result = await gitRun(['status', '--porcelain'], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
  // A status that cannot be read is treated as dirty: refusing an update is
  // recoverable, discarding a user's edit is not.
  return result.exitCode !== 0 || result.stdout.trim().length > 0;
}

/**
 * Compare one installed plugin against its remote.
 *
 * Every failure is a VALUE, never a throw: a plugin whose remote is unreachable
 * is a plugin whose freshness is unknown, which the pane renders as such. An
 * unreadable origin (a copied folder, a clone whose remote was removed) is the
 * one case that reports `null` for both sides rather than an error — there is
 * nothing to probe, and a red row for a plugin the user never installed from a
 * URL would be a fault about nothing.
 */
export async function probeGitUpdate(pluginId: string): Promise<PanelGitStatus> {
  const checkedAt = Date.now();
  const dir = join(getMarketplacePluginsDir(), pluginId);
  if (!(await pathExists(dir))) {
    return { current: null, latest: null, updateAvailable: false, checkedAt: null, error: 'the plugin directory is gone' };
  }

  const origin = await readGitOrigin(dir);
  if (!origin) {
    return { current: null, latest: null, updateAvailable: false, checkedAt: null };
  }

  const current = await readLocalHead(dir);
  const remote = await probeRemoteHead(dir);
  if (remote.sha === null) {
    return { current, latest: null, updateAvailable: false, checkedAt, ...(remote.error ? { error: remote.error } : {}) };
  }
  const updateAvailable = current !== null && current !== remote.sha;
  // The version only means anything when the two sides DIFFER, and reading it
  // needs the remote's tree — so the fetch happens here, on the one branch where
  // the answer is worth a round trip. An up-to-date clone pays nothing extra.
  const latestVersion = updateAvailable ? await readRemoteVersionAfterFetch(dir) : undefined;
  return {
    current,
    latest: remote.sha,
    updateAvailable,
    checkedAt,
    ...(latestVersion ? { latestVersion } : {}),
  };
}

/**
 * Fetch the remote's HEAD, then read the version its manifest declares.
 *
 * A shallow single-ref fetch of objects only: the working tree is untouched, so
 * a probe never changes what the plugin's directory holds — that is `update`'s
 * job, and it is the one that refuses a dirty tree.
 */
async function readRemoteVersionAfterFetch(dir: string): Promise<string | undefined> {
  const fetch = await gitRun(['fetch', '--depth', '1', '--quiet', 'origin', 'HEAD'], {
    cwd: dir,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (fetch.exitCode !== 0) return undefined;
  return readRemoteVersion(dir);
}

export interface GitUpdateResult {
  ok: boolean;
  pluginId: string;
  /** The commit the clone moved to, when it moved. */
  commit?: string;
  /** False when the clone was already at the remote's commit. */
  updated: boolean;
  /** Why the update did not happen — reported verbatim to the user. */
  error?: string;
  /** A rebuild that failed after the files moved. */
  warning?: string;
}

/**
 * Bring one git-installed plugin up to its remote, and rebuild it.
 *
 * The order is: refuse a dirty tree, fetch, reset, rebuild. The build runs LAST
 * and its failure is a warning rather than a failure — the files DID move, and
 * the pane's own Rebuild is the repair for a bundle that did not come out. The
 * scan is invalidated either way, because the manifest the scan reads may have
 * changed even when the build did not.
 */
export async function updateGitPlugin(pluginId: string): Promise<GitUpdateResult> {
  const dir = join(getMarketplacePluginsDir(), pluginId);
  if (!(await pathExists(dir))) return { ok: false, pluginId, updated: false, error: `No installed plugin with id "${pluginId}".` };

  const origin = await readGitOrigin(dir);
  if (!origin) return { ok: false, pluginId, updated: false, error: `${pluginId} is not a git clone, so it has no remote to update from.` };

  if (await isDirty(dir)) {
    return {
      ok: false,
      pluginId,
      updated: false,
      error: `${pluginId} has uncommitted changes, which an update would discard. Commit or discard them, then update again.`,
    };
  }

  const before = await readLocalHead(dir);
  const fetch = await gitRun(['fetch', '--depth', '1', 'origin', 'HEAD'], { cwd: dir, timeoutMs: FETCH_TIMEOUT_MS });
  if (fetch.failed) return { ok: false, pluginId, updated: false, error: 'The remote did not answer in time.' };
  if (fetch.exitCode !== 0) {
    return { ok: false, pluginId, updated: false, error: firstLine(fetch.stderr) || `git fetch exited with code ${fetch.exitCode}` };
  }

  const fetched = await gitRun(['rev-parse', 'FETCH_HEAD'], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
  const target = fetched.exitCode === 0 ? asSha(fetched.stdout) : null;
  if (!target) return { ok: false, pluginId, updated: false, error: 'The fetched ref could not be read.' };

  if (target === before) return { ok: true, pluginId, updated: false, commit: target };

  const reset = await gitRun(['reset', '--hard', target], { cwd: dir, timeoutMs: PROBE_TIMEOUT_MS });
  if (reset.exitCode !== 0) {
    return { ok: false, pluginId, updated: false, error: firstLine(reset.stderr) || 'The working copy could not be moved to the fetched commit.' };
  }

  invalidatePanelScan();

  const read = await readPluginManifest(dir);
  if (read.kind !== 'manifest') {
    return { ok: true, pluginId, updated: true, commit: target, warning: 'The files moved but the plugin now has no readable manifest.' };
  }
  const manifest = toManifest(read.value, dir);
  if ('error' in manifest) {
    return { ok: true, pluginId, updated: true, commit: target, warning: `The files moved but the manifest is invalid: ${manifest.error}` };
  }

  const build = await buildPanelPlugin(dir, manifest);
  invalidatePanelScan();
  if (build.status === 'failed') {
    return { ok: true, pluginId, updated: true, commit: target, warning: build.reason ?? 'the plugin did not build' };
  }
  return { ok: true, pluginId, updated: true, commit: target };
}
