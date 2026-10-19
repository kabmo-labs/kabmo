/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The right-panel button order, as the layouts read it.
 *
 * Backed by the GLOBAL `app_settings.omp_right_panel_order` (see
 * `shared/lib/workspace/panel-order.ts`), not by `layout.*` session state: the
 * bar lists the same panels in every chat, so a per-session order would
 * reshuffle the buttons the moment the user picked a different session.
 *
 * The read is synchronous from the primed settings snapshot, so the first
 * render already draws the stored order. A drop commits the new order and
 * notifies every bar on screen, because the readers all resolve against this
 * one module-level cache.
 *
 * The snapshot is compared by IDENTITY of the stored array, not by rebuilding
 * the list on every call: `writeSetting` replaces the stored value with the
 * exact array a write handed it, so a reference comparison is both correct and
 * free — and `useSyncExternalStore` would otherwise see a fresh array on every
 * render and re-render its consumer forever.
 */
import { useCallback } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  PANEL_ORDER_SETTING_KEY,
  mergeVisibleOrder,
  readPanelOrder,
  savePanelOrder,
  sortPanels,
} from '@/shared/lib/workspace/panel-order';

const listeners = new Set<() => void>();

/** The stored value the cache was built from, and the list it produced. */
let lastSource: unknown;
let cached: readonly string[] = [];

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): readonly string[] {
  const source = readKabmoSetting<unknown>(PANEL_ORDER_SETTING_KEY);
  if (source === lastSource) return cached;
  lastSource = source;
  cached = readPanelOrder();
  return cached;
}

/** Persist a new order and re-render every bar on screen. */
export function commitPanelOrder(ids: readonly string[]): void {
  savePanelOrder(ids);
  lastSource = undefined;
  for (const listener of listeners) listener();
}

/**
 * The stored order, plus what a bar needs: draw the catalog in it, and commit a
 * reorder of the panels that are on screen.
 */
export function usePanelOrder(): {
  order: readonly string[];
  /** `panels` in the stored order, ids the order does not name appended. */
  apply: <T extends { id: string }>(panels: readonly T[]) => T[];
  /**
   * Commit a reorder. `visibleIds` is what the bar drew before the drag and
   * `nextVisible` is what it drew after; the panels that were NOT drawn keep
   * their stored places (see `mergeVisibleOrder`).
   */
  commitReorder: (visibleIds: readonly string[], nextVisible: readonly string[]) => void;
} {
  const order = useSyncExternalStore(subscribe, snapshot);

  const apply = useCallback(<T extends { id: string }>(panels: readonly T[]) => sortPanels(panels, order), [order]);
  const commitReorder = useCallback(
    (visibleIds: readonly string[], nextVisible: readonly string[]) =>
      commitPanelOrder(mergeVisibleOrder(order, visibleIds, nextVisible)),
    [order],
  );

  return { order, apply, commitReorder };
}
