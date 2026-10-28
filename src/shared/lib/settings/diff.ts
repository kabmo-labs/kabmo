/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subset of a settings update that should be persisted.
 *
 * The settings modal keeps a full `SettingsState` snapshot from the moment it
 * opened and hands every edit to one writer. Writing the whole object back
 * republishes values the user never touched, from a snapshot that may be older
 * than what another writer (a second tab, an API call) has since stored — the
 * stale copy wins purely because it was written last.
 *
 * A key is persisted only when the update changed it:
 *
 * - **Object patch** — the keys it names, but only those whose value actually
 *   differs, so a no-op re-render does not touch the row.
 * - **Updater function** — every key whose value differs between `prev` and
 *   `next`; the function's own intent is not inspectable, so the diff is.
 *
 * Values are compared by identity, which is what `SettingsState` holds: strings,
 * numbers and booleans. A nested object would compare by reference and be
 * reported as changed — acceptable here, and better than dropping a real edit.
 */
export function diffSettings<T extends Record<string, any>>(
  prev: T,
  next: T,
  update: Partial<T> | ((prev: T) => T),
): Partial<T> {
  const patch: Partial<T> = {};
  const keys = typeof update === 'function' ? (Object.keys(next) as (keyof T)[]) : (Object.keys(update) as (keyof T)[]);
  for (const key of keys) {
    if (next[key] !== prev[key]) patch[key] = next[key];
  }
  return patch;
}
