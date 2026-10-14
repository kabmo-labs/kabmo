/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unmerged index entries: the seven porcelain pairs `git status` reports while
 * a merge, rebase, cherry-pick, revert or stash pop has stopped on a conflict.
 *
 * The pairs are NOT two independent columns the way a normal change is. Git
 * writes one letter per SIDE — `U` for unmerged, `A`/`D` for the add/delete the
 * side performed — so `UU` is "both modified", `AU` is "added by us" and `UA`
 * is "added by them". Reading them the way a clean status is read (`status[0]`
 * = index, `status[1]` = worktree) is what made every conflicted file report as
 * STAGED, and made `UU`/`UA`/`UD` fall through to the untracked branch and
 * render as "Untracked" — a conflicted file described as a file git has never
 * heard of.
 *
 * The table is the whole point: a code outside it is not a conflict, so
 * `isUnmergedCode` is the one predicate every surface tests, and a new pair
 * (git has never added one) would be a row rather than a branch at each call
 * site. Every pair's badge reads `Conflict`; the pair's own sentence is the
 * row's tooltip, and it is here rather than at the call site because the same
 * seven sentences are needed by the list, the tree and the diff toolbar.
 */

export const UNMERGED_CODES = {
  UU: 'Conflicted — both modified',
  AA: 'Conflicted — both added',
  DD: 'Conflicted — both deleted',
  AU: 'Conflicted — added by us',
  UA: 'Conflicted — added by them',
  DU: 'Conflicted — deleted by us',
  UD: 'Conflicted — deleted by them',
} as const;

export type UnmergedCode = keyof typeof UNMERGED_CODES;

/**
 * True for one of the seven unmerged pairs.
 *
 * A type guard rather than a lookup at each call site: it narrows, so
 * `UNMERGED_CODES[status]` type-checks after it, and the table is the only
 * place the vocabulary is written down. Case-sensitive and exact on purpose —
 * the pairs are uppercase, and a case-folded match would also claim the
 * one-letter legacy codes other callers pass in (`getGitStatusInfo` is reached
 * with `M`/`A`/`D`/`U` from the diff panel and the editor tabs).
 */
export function isUnmergedCode(status: unknown): status is UnmergedCode {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(UNMERGED_CODES, status);
}

/** Which side of a conflict a `<<<<<<<` / `>>>>>>>` marker block came from. */
export interface ConflictMarkers {
  /** The label git wrote after `<<<<<<<` — `HEAD`, or a branch/commit name. */
  ours?: string;
  /** The label git wrote after `>>>>>>>`. */
  theirs?: string;
}

/**
 * Read the two side labels out of a file holding conflict markers.
 *
 * This is the ONLY honest source for the words on a resolve button. `git
 * checkout --ours` / `--theirs` are inverted during a rebase — verified: on the
 * same two commits, a merge conflict's `--ours` yields the branch you are on
 * while a rebase conflict's `--ours` yields the branch being rebased ONTO — so
 * a button labelled "ours" that runs `--ours` silently takes the other side in
 * half the conflict states. The markers git itself wrote carry the right names,
 * and they are what the reader sees in the file.
 *
 * Scans only the first block (a file can hold several), because one dialog
 * answers one file and the first block's labels are the ones the reader met
 * first. A file with no markers yields `{}` — the caller falls back to
 * `ours`/`theirs`.
 */
export function parseConflictMarkers(text: string): ConflictMarkers {
  const markers: ConflictMarkers = {};
  for (const line of text.split('\n')) {
    if (!markers.ours && line.startsWith('<<<<<<<')) {
      markers.ours = line.slice(7).trim() || undefined;
      continue;
    }
    if (line.startsWith('>>>>>>>')) {
      markers.theirs = line.slice(7).trim() || undefined;
      break;
    }
  }
  return markers;
}

/** How an operation is named in a sentence — `merge`, `rebase`, `stash pop`. */
export const OPERATION_LABELS = {
  merge: 'merge',
  rebase: 'rebase',
  'rebase-apply': 'rebase',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  'stash-pop': 'stash pop',
} as const;
