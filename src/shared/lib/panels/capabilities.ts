/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the host can DO for a plugin, as a manifest may require it.
 *
 * ONE table, and it names only what ships TODAY. The honesty is the point: a
 * capability listed before it exists would let a plugin that needs it through
 * the scan and then fail at runtime with no reason — the exact outcome the
 * requirement exists to prevent. So a row is appended when the thing it names
 * actually lands, never in anticipation of it.
 *
 * The rows below `panel` were all SHIPPED long before they were listed here:
 * a plugin's server half, its own storage, RPC methods, a realtime topic and
 * declared settings have all been part of the API for releases, and a manifest
 * requiring any of them was refused by name for a capability the host already
 * provided. They are listed now because that refusal is a lie, and a table that
 * lies is worse than one that is incomplete — it names the wrong thing as the
 * problem.
 */
export const HOST_CAPABILITIES: readonly string[] = [
  'panel',
  'server',
  'storage',
  'rpc',
  'realtime',
  'settings',
  // The nested-repo scope the browsing panels share, exposed to plugins as
  // `repoScope()` / `setRepoScope()` / `subscribeRepoScope()` / `rescanRepoScope()`
  // on the UI kit's services. A plugin that renders a repo picker requires this
  // rather than drawing one that cannot reach the shared slot.
  'repo-scope',
];

/** The required capabilities this host does not provide, in declared order. */
export function missingCapabilities(required: readonly string[]): string[] {
  return required.filter((capability) => !HOST_CAPABILITIES.includes(capability));
}
