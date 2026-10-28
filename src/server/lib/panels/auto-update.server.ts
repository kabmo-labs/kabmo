/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The background pass that keeps git-installed panel plugins current.
 *
 * Opt-in, because a pass runs `git fetch` and a hard reset against a remote: it
 * reaches the network, it replaces files, and it does so with nobody watching.
 * The setting is read fresh on every pass, so switching it off in the pane stops
 * the next pass rather than the one after a restart.
 *
 * Only plugins with a readable `origin` are selected — the same predicate the
 * pane's Update button renders on — so a bundled install or a hand-copied folder
 * is never touched.
 *
 * A plugin whose update FAILS is retried on the next pass rather than disabled.
 * The common failure is a remote that is briefly unreachable or an authentication
 * prompt that cannot be answered in a background process, and both are conditions
 * that resolve themselves; disabling on the first failure would leave a plugin
 * silently frozen with no way to tell why. Every pass is bounded by one plugin
 * at a time, so a hung remote delays the rest rather than overlapping them.
 *
 * Anchored on `globalThis` for the reason the database handle and the scheduled
 * runtime are: a `bun --hot` module re-evaluation would otherwise leave the
 * previous `setInterval` running against a stale closure, and every save would
 * add one more pass.
 */

import { discoverPanelPlugins } from '@/server/lib/panels/registry.server';
import { readPluginAutoUpdate } from '@/server/lib/panels/state.server';
import { probeGitUpdate, updateGitPlugin } from '@/server/lib/panels/git-update.server';
import { writeGitStatus } from '@/server/lib/panels/git-status.server';

/**
 * How often the pass runs. An hour is a compromise with no measurement behind
 * it: a plugin repository changes on the order of days, and the pass costs one
 * `ls-remote` per git-installed plugin — a round trip a user will never notice,
 * while a shorter interval would ask a remote the same question dozens of times
 * for an answer that cannot have changed.
 */
const INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first pass: boot owns the first seconds. */
const FIRST_PASS_DELAY_MS = 60_000;

interface AutoUpdateRuntime {
  timer: NodeJS.Timeout | null;
  /** Set while a pass runs, so a slow remote cannot stack passes. */
  running: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPanelAutoUpdate: AutoUpdateRuntime | undefined;
}

function runtime(): AutoUpdateRuntime {
  return (globalThis.__kabmoPanelAutoUpdate ??= { timer: null, running: false });
}

/** What one auto-update pass did, so a caller can report it. */
export interface PanelAutoUpdateOutcome {
  checked: string[];
  updated: string[];
  failed: Array<{ pluginId: string; error: string }>;
}

/**
 * Probe every git-installed plugin, and update the ones that are behind.
 *
 * Returns what it did, for the smoke path and for tests. Never throws: a failure
 * on one plugin is recorded against that plugin and the pass continues.
 */
export async function runPanelAutoUpdatePass(): Promise<PanelAutoUpdateOutcome> {
  const checked: string[] = [];
  const updated: string[] = [];
  const failed: Array<{ pluginId: string; error: string }> = [];

  const { plugins } = await discoverPanelPlugins();
  for (const plugin of plugins) {
    if (!plugin.gitOrigin) continue;
    checked.push(plugin.pluginId);
    try {
      const status = await probeGitUpdate(plugin.pluginId);
      writeGitStatus(plugin.pluginId, status);
      if (!status.updateAvailable) continue;
      const result = await updateGitPlugin(plugin.pluginId);
      if (!result.ok) {
        failed.push({ pluginId: plugin.pluginId, error: result.error ?? 'the update failed' });
        continue;
      }
      updated.push(plugin.pluginId);
      writeGitStatus(plugin.pluginId, {
        current: result.commit ?? null,
        latest: result.commit ?? null,
        updateAvailable: false,
        checkedAt: Date.now(),
      });
    } catch (error) {
      failed.push({ pluginId: plugin.pluginId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked, updated, failed };
}

/**
 * One tick: run a pass only when the setting is on and no pass is already in
 * flight. Both guards live here rather than at the interval, so a caller that
 * invokes the tick directly gets the same behaviour.
 */
async function tick(): Promise<void> {
  const state = runtime();
  if (state.running) return;
  if (!(await readPluginAutoUpdate())) return;
  state.running = true;
  try {
    const result = await runPanelAutoUpdatePass();
    if (result.updated.length > 0) {
      console.log(`[panels] auto-updated: ${result.updated.join(', ')}`);
    }
    for (const failure of result.failed) console.error(`[panels] ${failure.pluginId}: auto-update failed — ${failure.error}`);
  } catch (error) {
    console.error('[panels] auto-update pass skipped:', error);
  } finally {
    state.running = false;
  }
}

/**
 * Start the pass. Idempotent — a hot reload re-runs the server entry, and a
 * second interval against the same slot would double every pass.
 */
export function startPanelAutoUpdate(): void {
  const state = runtime();
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), INTERVAL_MS);
  setTimeout(() => void tick(), FIRST_PASS_DELAY_MS);
}

/** Stop the pass. For tests and for a shutdown that wants no timer left. */
export function stopPanelAutoUpdate(): void {
  const state = runtime();
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
}
