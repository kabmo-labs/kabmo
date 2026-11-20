/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which row of the commit modal has its detail open.
 *
 * One hash, not a set: the open row carries the action strip, the body and the
 * changed-file list, which is the focused thing on the page, so opening another
 * row closes the previous one. The modal keeps a row's detail to a single
 * reader at a time rather than letting the list fill with open rows.
 *
 * A page that opens with a row expanded is the bug this replaces: the modal
 * seeded the first commit as selected, so the history arrived with one commit
 * already grown and every other commit pushed down before the reader asked for
 * anything — and clicking that row again could not close it. Nothing is open
 * until a row is clicked, and clicking the open row closes it.
 *
 * The page is part of the state so a NEW page (a refresh, or the modal reopened)
 * starts collapsed. The modal stays mounted while closed, so state alone would
 * carry the last open row into the next open.
 */

import { useCallback, useState } from 'preact/hooks';
import type { CommitHistoryPage } from '@/shared/types/git';

interface ExpansionState {
  /** The page the open row belongs to. */
  page: CommitHistoryPage | null;
  /** The open row's hash, or `''`. */
  hash: string;
}

export function useCommitExpansion(output: CommitHistoryPage | null): {
  expandedHash: string;
  toggleExpanded: (hash: string) => void;
} {
  const [state, setState] = useState<ExpansionState>({ page: output, hash: '' });

  // Derived during render, not reset in an effect: a stale page's row would
  // otherwise stay open for a frame after the new page's rows are on screen.
  const expandedHash = state.page === output ? state.hash : '';

  const toggleExpanded = useCallback(
    (hash: string) => {
      setState((current) => {
        const open = current.page === output && current.hash === hash;
        return { page: output, hash: open ? '' : hash };
      });
    },
    [output],
  );

  return { expandedHash, toggleExpanded };
}
