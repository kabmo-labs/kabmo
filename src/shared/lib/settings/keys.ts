/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `app_settings` keys that carry Kabmo's own preferences.
 *
 * Two spellings exist for the settings blob, and the split is deliberate:
 *
 * - `kabmo_settings` is the key every writer uses now.
 * - `omp_chamber_settings` is the key installs wrote before the rename. It is
 *   still READ, and its keys are merged UNDER the new blob, so an install that
 *   upgrades keeps its theme, transport, keybindings and every other preference
 *   without a migration pass that could fail halfway. Nothing writes it any
 *   more, so it drains as each key is rewritten.
 *
 * The merge order is the whole contract: the new blob wins on a shared key, so
 * a preference changed after the upgrade is not reverted by a stale legacy row.
 *
 * This module has no imports on purpose — the client, the SSR shell and the
 * server routes all resolve the same two strings through it.
 */

/** The blob every writer uses. */
export const SETTINGS_BLOB_KEY = 'kabmo_settings';

/** The pre-rename blob, read as a fallback and never written. */
export const LEGACY_SETTINGS_BLOB_KEY = 'omp_chamber_settings';

/**
 * Read the blob from a flat `app_settings` map, with the legacy blob beneath it.
 *
 * Both blobs are plain objects of preference keys, so the merge is per KEY
 * rather than per blob: an install that predates the rename has every key in
 * the legacy row and none in the new one, and a partial upgrade can have some
 * of each.
 */
export function readSettingsBlob(appSettings?: Record<string, unknown> | null): Record<string, unknown> {
  const legacy = appSettings?.[LEGACY_SETTINGS_BLOB_KEY];
  const current = appSettings?.[SETTINGS_BLOB_KEY];
  return {
    ...(isPlainRecord(legacy) ? legacy : {}),
    ...(isPlainRecord(current) ? current : {}),
  };
}

/** A JSON object that is not an array — the shape both blobs are written as. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
