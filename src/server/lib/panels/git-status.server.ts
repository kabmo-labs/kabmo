/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The last known freshness of each git-installed plugin.
 *
 * A freshness probe is a NETWORK round trip (`git ls-remote`), so it cannot run
 * inside the panel scan — the scan is reached by every `/api/panels` request and
 * by every republish of the `panels` topic. The probe result is therefore cached
 * here, and the scan only reads the cache: a plugin whose remote was never asked
 * reports `null`, and the pane renders "not checked yet" rather than a wrong
 * answer.
 *
 * The map lives on `globalThis` for the reason the scan cache and the database
 * handle do: `bun --hot` re-evaluates this module, and a module-level binding
 * would drop the statuses while the plugins they describe are still installed.
 */

import type { PanelGitStatus } from '@/shared/types';

declare global {
  // eslint-disable-next-line no-var
  var __ompChamberPanelGitStatus: Map<string, PanelGitStatus> | undefined;
}

function store(): Map<string, PanelGitStatus> {
  return (globalThis.__ompChamberPanelGitStatus ??= new Map());
}

/** The cached freshness of one plugin, or undefined when it was never probed. */
export function readGitStatus(pluginId: string): PanelGitStatus | undefined {
  return store().get(pluginId);
}

/** Record a probe result, or forget one when the plugin is gone. */
export function writeGitStatus(pluginId: string, status: PanelGitStatus | null): void {
  if (status === null) store().delete(pluginId);
  else store().set(pluginId, status);
}

/** Every cached status, keyed by plugin id — the payload's own shape. */
export function readAllGitStatuses(): Record<string, PanelGitStatus> {
  return Object.fromEntries(store());
}
