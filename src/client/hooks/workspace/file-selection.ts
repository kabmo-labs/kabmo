/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's MULTI-selection: which rows are marked, and what a click on
 * one means.
 *
 * The panel opens files, so the click has to do two jobs at once — the first
 * click selects AND opens, a shift-click selects a block without opening, and a
 * meta/ctrl-click adds or removes one row. That split lives here rather than in
 * `TreeItem` because the range needs the VISIBLE row order, which is the
 * panel's tree, not the row's own state.
 *
 * The anchor is deliberately sticky: shift-clicking a third time extends from
 * the same row the plain click started at, which is what every file manager
 * does. A plain click moves it; a toggle moves it too, so the next shift range
 * starts where the user last touched.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';

/** What a click with the platform modifiers means. */
export type SelectionGesture = 'plain' | 'range' | 'toggle';

/** The gesture a click carries: shift ranges, meta/ctrl toggles, else plain. */
export function selectionGestureOf(event: {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): SelectionGesture {
  if (event.shiftKey) return 'range';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'plain';
}

/**
 * The paths between `anchor` and `target` in visible order, inclusive.
 *
 * Empty when either end is not visible: the anchor can survive a folder being
 * collapsed, and a range across rows that are no longer drawn would select
 * entries the user cannot see.
 */
export function rangePaths(
  order: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  if (!anchor) return [target];
  const from = order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return order.slice(start, end + 1);
}

export interface FileSelection {
  /** The marked paths. Stable identity until the selection changes. */
  selected: ReadonlySet<string>;
  /** How many rows are marked — the menus' labels read it. */
  count: number;
  /** The row a shift-click ranges from. */
  anchor: string | null;
  gestureOf: (event: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => SelectionGesture;
  /** Apply a gesture to `path`; a plain click replaces the selection. */
  applyGesture: (gesture: SelectionGesture, path: string) => void;
  /** Right-click: keep a selection the row belongs to, else select just it. */
  ensureForContext: (path: string) => void;
  /** Drop the whole selection — a repo switch, or Escape. */
  clear: () => void;
}

export function useFileSelection(order: readonly string[]): FileSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const applyGesture = useCallback((gesture: SelectionGesture, path: string) => {
    if (gesture === 'range') {
      setSelected(new Set(rangePaths(order, anchor, path)));
      return;
    }
    setAnchor(path);
    if (gesture === 'toggle') {
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      return;
    }
    setSelected(new Set([path]));
  }, [anchor, order]);

  const ensureForContext = useCallback((path: string) => {
    setSelected((previous) => {
      if (previous.has(path)) return previous;
      return new Set([path]);
    });
    setAnchor(path);
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const gestureOf = useCallback(selectionGestureOf, []);

  return useMemo(
    () => ({ selected, count: selected.size, anchor, gestureOf, applyGesture, ensureForContext, clear }),
    [selected, anchor, gestureOf, applyGesture, ensureForContext, clear],
  );
}

/** A path's place in the visible tree, with the facts a batch action needs. */
export interface SelectionEntry {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  /** Nesting depth, for the flat order the range is computed against. */
  depth: number;
}

/**
 * The rows the panel is DRAWING, in order — the coordinate space of a
 * shift-range.
 *
 * A folder contributes itself and, when open, its children immediately after
 * it: that is the DOM order the rows are read in. `isOpen` is the panel's own
 * expansion set plus the transient `forceExpanded` a chain row carries.
 */
export interface SelectionNode {
  path: string;
  name: string;
  type: 'file' | 'folder';
  children?: readonly SelectionNode[];
  forceExpanded?: boolean;
}

export function visibleEntriesOf(
  nodes: readonly SelectionNode[],
  isOpen: (node: SelectionNode) => boolean,
  depth = 0,
  out: SelectionEntry[] = [],
): SelectionEntry[] {
  for (const node of nodes) {
    out.push({ path: node.path, name: node.name, kind: node.type === 'folder' ? 'folder' : 'file', depth });
    if (node.type === 'folder' && isOpen(node) && Array.isArray(node.children)) {
      visibleEntriesOf(node.children, isOpen, depth + 1, out);
    }
  }
  return out;
}
