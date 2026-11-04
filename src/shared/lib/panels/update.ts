/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Is an installed plugin behind whatever publishes it?
 *
 * ONE answer, asked by three surfaces — the card's Update button, the Installed
 * header's count and the Update-all button — because they answer the same
 * question and disagreeing once is the whole bug: a header saying "2 updates
 * available" over a single button is a count of nothing.
 *
 * Two sources, and the two are probed differently:
 *
 * - a BUNDLED install's source is the store, whose manifest sits on disk, so the
 *   comparison is a version against a version;
 * - a GIT clone's source is its remote, whose HEAD only a probe knows. A commit
 *   difference therefore counts even when the versions are equal (a fix shipped
 *   without a bump), which is why the probe's own `updateAvailable` is read
 *   rather than a version pair alone.
 *
 * A local directory has no source and never updates; `false` is its honest
 * answer, and its card offers no button at all.
 */

import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';
import { isNewer } from '@/shared/lib/updates/semver';

/** Where the update would come from, when one is pending. */
export interface PluginUpdate {
  /** The version the update would install, when the source declares one. */
  version?: string;
}

/**
 * The pending update for one plugin, or null when there is nothing to apply.
 *
 * Returns the target version rather than a bare boolean so a button can name
 * what it would install — `Update to v0.3.0` — instead of leaving the reader to
 * compare two numbers themselves.
 */
export function pluginUpdate(
  plugin: Pick<PanelPluginStatus, 'version' | 'latestVersion' | 'origin'>,
  gitStatus: PanelGitStatus | undefined,
): PluginUpdate | null {
  if (plugin.origin === 'local') return null;

  // A clone: the PROBE is the verdict, not a version pair. Its `latestVersion`
  // is written only on the branch where the commits differ, so it doubles as the
  // target — and a clone that was never probed is unknown rather than current,
  // which is what the card's own freshness row says too.
  if (plugin.origin === 'git') {
    if (gitStatus?.updateAvailable !== true) return null;
    const target = plugin.latestVersion ?? gitStatus.latestVersion;
    return target ? { version: target } : {};
  }

  // A store install: the store's version is the answer, and "same" means there
  // is nothing to fetch — except for a shipped fix that forgot its bump, which
  // only the server can see and which the boot sync applies without asking.
  const target = plugin.latestVersion;
  if (!target || !isNewer(target, plugin.version)) return null;
  return { version: target };
}

/** How many installed plugins have an update waiting. */
export function countPluginUpdates(
  plugins: readonly Pick<PanelPluginStatus, 'pluginId' | 'version' | 'latestVersion' | 'origin'>[],
  gitStatus: Readonly<Record<string, PanelGitStatus>>,
): number {
  return plugins.filter((plugin) => pluginUpdate(plugin, gitStatus[plugin.pluginId]) !== null).length;
}
