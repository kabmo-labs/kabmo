/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The split editor's state, per session.
 *
 * The RULES live in `shared/lib/workspace/split-editor.ts` (pure, unit-tested); this is the
 * session-backed wrapper the panel calls, plus the two derivations it needs — which tab the
 * right pane shows, and whether the column is split at all.
 *
 * ## `enabled: false` is what stops a tree
 *
 * The right pane renders the SAME panel, so without this the pane could split again and the
 * column would become a tree with no way to reason about widths, close semantics or what
 * the strip owns. A pane never splits.
 *
 * ## A stale persisted id is DROPPED, not trusted
 *
 * `readSplitState` checks the id against the OPEN tabs, so a reload after the right pane's
 * tab was closed elsewhere opens an unsplit column instead of an empty half the user has to
 * discover how to dismiss — and `splitAfterActivate` collapses the split when the user
 * activates the very tab the right pane shows, because one file twice is a wide pane with a
 * divider through it.
 */

import { useCallback } from 'preact/hooks';

import { useSessionState } from '@/client/hooks/workspace/session-state';
import {
  DEFAULT_SPLIT,
  canSplitTo,
  clampSplitFraction,
  readSplitState,
  splitAfterActivate,
  type SplitEditorState,
} from '@/shared/lib/workspace/split-editor';
import type { OpenedFile } from '@/shared/types/fs';

interface UseSplitEditorOptions {
  openedFiles: OpenedFile[];
  /** The LEFT pane's tab. */
  activeFileId: number | string | null;
  /** False in a split pane: a pane never splits again. */
  enabled: boolean;
}

export interface SplitEditorHandle {
  /** The tab the right pane shows, or null when the column is not split. */
  rightFile: OpenedFile | null;
  fraction: number;
  /** Split to `id`, or change which tab the right pane shows. Silent on a refusal. */
  splitTo: (id: number | string | null) => void;
  /** Close the pane. The TAB stays open — a split is a view. */
  close: () => void;
  /** Persist a dragged divider position, clamped. */
  setFraction: (fraction: number) => void;
}

export function useSplitEditor({ openedFiles, activeFileId, enabled }: UseSplitEditorOptions): SplitEditorHandle {
  const [stored, setStored] = useSessionState<unknown>('editor.split', DEFAULT_SPLIT);
  const openIds = openedFiles.map((file) => file.id);
  // A persisted id for a tab that is gone is dropped by `readSplitState`; activating the
  // tab the right pane already shows collapses the split rather than drawing it twice.
  const state: SplitEditorState = splitAfterActivate(readSplitState(stored, openIds), activeFileId);

  const rightFile =
    enabled && state.rightFileId !== null
      ? openedFiles.find((file) => file.id === state.rightFileId) ?? null
      : null;

  const splitTo = useCallback(
    (id: number | string | null) => {
      if (id !== null && !canSplitTo(id, activeFileId, openIds)) return;
      setStored({ ...state, rightFileId: id });
    },
    // `openIds` is derived from `openedFiles` each render; the id list is what the guard
    // reads, so the callback follows it.
    [state, setStored, activeFileId, openIds],
  );

  const close = useCallback(() => setStored({ ...state, rightFileId: null }), [state, setStored]);

  const setFraction = useCallback(
    (fraction: number) => setStored({ ...state, fraction: clampSplitFraction(fraction) }),
    [state, setStored],
  );

  return { rightFile, fraction: state.fraction, splitTo, close, setFraction };
}
