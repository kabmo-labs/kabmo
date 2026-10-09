/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the host can DO for a plugin, as a manifest may require it.
 *
 * ONE table, and it names only what ships TODAY. The honesty is the point: a
 * capability listed before it exists would let a plugin that needs it through
 * the scan and then fail at runtime with no reason — the exact outcome the
 * requirement exists to prevent. So a row is appended when the thing it names
 * actually lands (`server`, `storage`, `rpc`, `realtime`, `settings`), never
 * in anticipation of it.
 */
export const HOST_CAPABILITIES: readonly string[] = ['panel'];

/** The required capabilities this host does not provide, in declared order. */
export function missingCapabilities(required: readonly string[]): string[] {
  return required.filter((capability) => !HOST_CAPABILITIES.includes(capability));
}
