/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bringing one installed panel plugin — or all of them — up to whatever owns it.
 *
 * Two sources publish plugin updates and the pane offers ONE Update button, so
 * the dispatch lives here rather than in the route: a git clone is fetched and
 * reset to its remote's HEAD (`git-update.server.ts`), while a bundled install
 * takes the store's copy (`sync.server.ts`) under the same edit gate the boot
 * pass uses. A directory with neither source is refused by name — "nothing
 * updates it" is a fact the reader needs, not a silent no-op.
 *
 * Every update unloads the plugin's SERVER half BEFORE the files move and
 * reloads it afterwards, and only when it was loaded to begin with: the module
 * is already imported and its registrations are live, so a half that kept
 * running would answer from code the directory no longer holds — while loading
 * one that was never running (a disabled plugin, or one with no server entry)
 * would invent a half the user switched off.
 */

import { join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import {
  discoverPanelPlugins,
  getBundledMarketplaceDir,
  getMarketplacePluginsDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';
import { readGitOrigin } from '@/server/lib/panels/git-clone.server';
import { probeGitUpdate, updateGitPlugin } from '@/server/lib/panels/git-update.server';
import { writeGitStatus } from '@/server/lib/panels/git-status.server';
import { syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { loadedPlugin } from '@/server/lib/plugins/loader.server';
import { syncPluginServer } from '@/server/lib/plugins/server-half.server';

/** What one plugin's update did. */
export interface PanelUpdateOutcome {
  pluginId: string;
  /** True when files actually moved. */
  updated: boolean;
  /** The version or commit it was at, for a bundled update. */
  from?: string;
  /** The version or commit it moved to. */
  to?: string;
  /** Why nothing moved — a refusal names its reason. */
  error?: string;
  /** A rebuild that failed after the files moved. */
  warning?: string;
}

/** What an update-all pass did, per plugin. */
export interface PanelUpdateAllOutcome {
  /** Plugins whose files moved. */
  updated: string[];
  /** Plugins left as they were, with the reason. */
  refused: Array<{ pluginId: string; error: string }>;
  /** Updates that moved files but left a message, e.g. a failed rebuild. */
  warnings: Array<{ pluginId: string; warning: string }>;
}

/** Where an install's updates come from, read off the directory itself. */
async function sourceOf(pluginId: string, dir: string): Promise<'git' | 'bundled' | 'local'> {
  if (await readGitOrigin(dir)) return 'git';
  const storeDir = join(getBundledMarketplaceDir(), 'plugins', pluginId);
  return (await pathExists(storeDir)) ? 'bundled' : 'local';
}

/**
 * Bring ONE installed plugin up to its source.
 *
 * Never throws for an expected refusal (a dirty clone, a hand-edited bundled
 * copy, a plugin that is not there): the answer is a value the pane reports.
 */
export async function updatePanelPlugin(pluginId: string): Promise<PanelUpdateOutcome> {
  const dir = join(getMarketplacePluginsDir(), pluginId);
  if (!(await pathExists(dir))) {
    return { pluginId, updated: false, error: `No installed plugin with id "${pluginId}".` };
  }

  const source = await sourceOf(pluginId, dir);
  if (source === 'local') {
    return {
      pluginId,
      updated: false,
      error: `${pluginId} is a local directory — it has no remote and the store does not ship it, so nothing publishes an update for it.`,
    };
  }

  // Read BEFORE the unload: after it, the registry can no longer say whether
  // this plugin's server half was running.
  const wasLoaded = loadedPlugin(pluginId) !== undefined;
  await syncPluginServer(pluginId, false);
  try {
    return source === 'git' ? await updateFromRemote(pluginId) : await updateFromStore(pluginId);
  } finally {
    if (wasLoaded) await syncPluginServer(pluginId, true);
  }
}

/** Fetch the remote's HEAD, move the clone to it, rebuild. */
async function updateFromRemote(pluginId: string): Promise<PanelUpdateOutcome> {
  const result = await updateGitPlugin(pluginId);
  if (!result.ok) return { pluginId, updated: false, error: result.error };

  // The freshness this update just achieved is WRITTEN rather than probed
  // again: the commit is known, and a second round trip could only disagree
  // with the reset that already happened.
  writeGitStatus(pluginId, {
    current: result.commit ?? null,
    latest: result.commit ?? null,
    updateAvailable: false,
    checkedAt: Date.now(),
  });
  return {
    pluginId,
    updated: result.updated,
    ...(result.commit ? { to: result.commit } : {}),
    ...(result.warning ? { warning: result.warning } : {}),
  };
}

/**
 * Apply the store's copy under the sync's own gate.
 *
 * The gate — not the caller — decides whether anything is applied: a tree the
 * user edited is REFUSED here exactly as it is at boot, and the files that
 * differ are named so the pane's blocked notice can offer the override. An
 * update button that overwrote them would be the force-sync escape hatch
 * without the warning.
 */
async function updateFromStore(pluginId: string): Promise<PanelUpdateOutcome> {
  const synced = await syncBundledPlugins({ only: pluginId });

  const failure = synced.failed.find((entry) => entry.pluginId === pluginId);
  if (failure) return { pluginId, updated: false, error: failure.error };

  const blocked = synced.blocked.find((entry) => entry.pluginId === pluginId);
  if (blocked) return { pluginId, updated: false, error: blockedReason(pluginId, blocked.changed.length) };

  const applied = synced.updated.find((entry) => entry.pluginId === pluginId);
  if (!applied) return { pluginId, updated: false };
  return {
    pluginId,
    updated: true,
    from: applied.from,
    to: applied.to,
    ...(applied.warning ? { warning: applied.warning } : {}),
  };
}

/**
 * Apply every update that is actually available, and report each one.
 *
 * Git clones are PROBED first and only the ones behind are fetched-and-reset:
 * an update against a clone already at its remote's HEAD would be a network
 * round trip that changes nothing.
 *
 * Bundled installs run one pass over the store — the same pass the boot runs —
 * and only the plugins it actually moved are reloaded afterwards. Unloading
 * every bundled server half BEFORE the pass would be the safer ordering for a
 * plugin that is about to be replaced, but it also stops the panels of every
 * bundled plugin on a pass that usually changes nothing; the pass replaces
 * files rather than removing them, so the reload afterwards is what keeps the
 * running code honest.
 */
export async function updateAllPanelPlugins(): Promise<PanelUpdateAllOutcome> {
  const outcome: PanelUpdateAllOutcome = { updated: [], refused: [], warnings: [] };
  const { plugins } = await discoverPanelPlugins();

  const record = (result: PanelUpdateOutcome): void => {
    if (result.updated) outcome.updated.push(result.pluginId);
    if (result.error) outcome.refused.push({ pluginId: result.pluginId, error: result.error });
    if (result.warning) outcome.warnings.push({ pluginId: result.pluginId, warning: result.warning });
  };

  for (const plugin of plugins) {
    if (!plugin.gitOrigin) continue;
    const status = await probeGitUpdate(plugin.pluginId);
    writeGitStatus(plugin.pluginId, status);
    if (!status.updateAvailable) continue;
    record(await updatePanelPlugin(plugin.pluginId));
  }

  const synced = await syncBundledPlugins();
  for (const entry of synced.updated) {
    outcome.updated.push(entry.pluginId);
    if (entry.warning) outcome.warnings.push({ pluginId: entry.pluginId, warning: entry.warning });
    // Reload only a half that was RUNNING: loading one that was not would switch
    // a disabled plugin's routes on behind the switch that says off.
    if (loadedPlugin(entry.pluginId)) {
      await syncPluginServer(entry.pluginId, false);
      await syncPluginServer(entry.pluginId, true);
    }
  }
  for (const entry of synced.blocked) {
    outcome.refused.push({ pluginId: entry.pluginId, error: blockedReason(entry.pluginId, entry.changed.length) });
  }
  for (const entry of synced.failed) outcome.refused.push(entry);

  invalidatePanelScan();
  return outcome;
}

/** The one sentence a refused bundled update reports, so both callers agree. */
function blockedReason(pluginId: string, changed: number): string {
  return `${pluginId} has local changes in ${changed} file${changed === 1 ? '' : 's'}, so its bundled update is paused. Nothing was replaced.`;
}
