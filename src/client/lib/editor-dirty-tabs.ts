/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which OPEN editor tabs hold edits that are not on disk.
 *
 * `useFileEditor` computes `isDirty` for the ACTIVE tab, and that is all a single
 * hook can know: it caches one buffer at a time. The tab strip needs the same
 * answer for a BACKGROUND tab — the one the user is about to close — so the editor
 * publishes a per-tab record here and the strip reads it.
 *
 * ## Why a store and not a prop
 *
 * The editor panel owns the tabs (`openedFiles` comes from the layout) while the
 * buffer state lives in `useFileEditor`. Threading a `dirtyIds` prop through
 * `Editor → EditorTabs` would mean the panel recomputing dirtiness it cannot see;
 * a store lets the ONE component that knows (the editor) publish it, and the one
 * that draws it (the strip) subscribe.
 *
 * ## A closed tab's entry is dropped with the tab
 *
 * Keyed by tab id, and `retain` prunes it — the same lifecycle as the content
 * cache. A stale entry would draw a dot on a freshly opened tab that happens to
 * reuse an id.
 */

import { useSyncExternalStore } from 'preact/compat';

/** Tab ids currently holding unsaved edits. */
const dirty = new Set<string | number>();
const listeners = new Set<() => void>();
/** A stable snapshot object, so `useSyncExternalStore` does not re-render forever. */
let snapshot: ReadonlySet<string | number> = new Set();

function publish(): void {
  snapshot = new Set(dirty);
  for (const listener of [...listeners]) listener();
}

/** Replace the whole set. The editor calls this after every render that moved it. */
export function setDirtyTabs(ids: Iterable<string | number>): void {
  const next = new Set(ids);
  if (next.size === dirty.size) {
    let same = true;
    for (const id of next) {
      if (!dirty.has(id)) { same = false; break; }
    }
    if (same) return;
  }
  dirty.clear();
  for (const id of next) dirty.add(id);
  publish();
}

/** Drop the ids that left the tab set. */
export function retainDirtyTabs(keep: Iterable<string | number>): void {
  const keepSet = new Set(keep);
  let dropped = false;
  for (const id of [...dirty]) {
    if (!keepSet.has(id)) { dirty.delete(id); dropped = true; }
  }
  if (dropped) publish();
}

/** Whether `id` currently holds unsaved edits. */
export function isTabDirty(id: string | number): boolean {
  return dirty.has(id);
}

/** Whether ANY tab does — the condition `beforeunload` is armed on. */
export function hasDirtyTabs(): boolean {
  return dirty.size > 0;
}

/**
 * Observe changes.
 *
 * Exported because the hook is not the only reader that matters: the panel's own
 * tests assert that an unchanged publish notifies nobody, and a subscription is the
 * only way to see that.
 */
export function subscribeDirtyTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const subscribe = subscribeDirtyTabs;

/** The live set, for a component that draws a dot per row. */
export function useDirtyTabs(): ReadonlySet<string | number> {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Test seam: forget every entry. */
export function resetDirtyTabs(): void {
  if (dirty.size === 0) return;
  dirty.clear();
  publish();
}
