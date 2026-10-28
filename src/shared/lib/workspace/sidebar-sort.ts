/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sidebar workspace ordering, shared by the desktop and mobile session
 * sidebars. One implementation is deliberate: the two sidebars used to carry
 * their own comparators, and the mobile copy silently dropped both time-based
 * options while the desktop copy compared omp session UUIDs numerically
 * (Math.max over strings -> NaN -> a no-op sort).
 */

import type { SessionSortOption, WorkspaceFolderData } from '@/shared/types';

/** Epoch ms of an ISO timestamp; NaN when missing or unparseable. */
function parseTime(value?: string | null): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Epoch ms of a folder's newest session; -Infinity when it has none. */
function latestSessionTime(folder: WorkspaceFolderData): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const session of folder.sessions ?? []) {
    const time = parseTime(session.updated_at ?? session.created_at);
    if (time > latest) latest = time;
  }
  return latest;
}

/**
 * Highest numeric session id in a folder (demo/mock ids are SQLite
 * AUTOINCREMENT; real omp ids are UUIDs and yield -Infinity). Only a
 * tiebreaker for equal timestamps — the norm in demo mode, where every seeded
 * row shares one CURRENT_TIMESTAMP.
 */
function latestSessionSeq(folder: WorkspaceFolderData): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const session of folder.sessions ?? []) {
    const id = Number(session.id);
    if (Number.isFinite(id) && id > latest) latest = id;
  }
  return latest;
}

/** Numeric folder id, or -Infinity for a non-numeric id. */
function folderId(folder: WorkspaceFolderData): number {
  const id = Number(folder.id);
  return Number.isFinite(id) ? id : Number.NEGATIVE_INFINITY;
}

/** Descending compare that is safe for -Infinity/-Infinity (never NaN). */
function compareDesc(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/** Ascending compare that is safe for -Infinity/-Infinity (never NaN). */
function compareAsc(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * Order two sidebar workspaces. Pinned workspaces always lead; every option
 * then falls back to a deterministic tiebreaker so equal keys never leave the
 * order to chance.
 *
 * - `A-Z` / `Z-A`          — folder name, then folder id asc.
 * - `LATEST_SESSION`       — newest session activity in the folder
 *                            (updated_at, else created_at), then highest
 *                            numeric session id (demo mode), then folder id
 *                            desc. Folders without sessions sort last.
 * - `LATEST_ADDED`         — newest folder first (folder id desc), then name.
 */
export function compareFolders(
  a: WorkspaceFolderData,
  b: WorkspaceFolderData,
  sortOption: SessionSortOption,
): number {
  const pinnedA = Boolean(a.isPinned);
  const pinnedB = Boolean(b.isPinned);
  if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;

  switch (sortOption) {
    case 'Z-A': {
      const byName = b.name.localeCompare(a.name);
      return byName !== 0 ? byName : compareAsc(folderId(a), folderId(b));
    }
    case 'LATEST_SESSION': {
      const byTime = compareDesc(latestSessionTime(a), latestSessionTime(b));
      if (byTime !== 0) return byTime;
      const bySeq = compareDesc(latestSessionSeq(a), latestSessionSeq(b));
      if (bySeq !== 0) return bySeq;
      const byId = compareDesc(folderId(a), folderId(b));
      return byId !== 0 ? byId : a.name.localeCompare(b.name);
    }
    case 'LATEST_ADDED': {
      const byId = compareDesc(folderId(a), folderId(b));
      return byId !== 0 ? byId : a.name.localeCompare(b.name);
    }
    case 'A-Z':
    default: {
      const byName = a.name.localeCompare(b.name);
      return byName !== 0 ? byName : compareAsc(folderId(a), folderId(b));
    }
  }
}

/** Non-mutating workspace sort — returns a new array, never reorders in place. */
export function sortFolders(
  folders: WorkspaceFolderData[],
  sortOption: SessionSortOption,
): WorkspaceFolderData[] {
  return [...folders].sort((a, b) => compareFolders(a, b, sortOption));
}

/** All supported workspace sort options, in menu order. */
const SESSION_SORT_OPTIONS: readonly SessionSortOption[] = ['A-Z', 'Z-A', 'LATEST_SESSION', 'LATEST_ADDED'];

/**
 * Sort applied when no preference is stored: newest session activity first.
 * The server (`serverSidebarSort`) and the client controller must both fall
 * back to this same value, or the seeded SSR payload would arrive in one order
 * and be re-sorted in the browser to another (the load flicker `sidebarSort`
 * exists to prevent).
 */
export const DEFAULT_SESSION_SORT_OPTION: SessionSortOption = 'LATEST_SESSION';

/**
 * Narrow an untrusted value (a DB-stored preference, a URL param) to a sort
 * option. The loader and both sidebars must agree on what counts as a valid
 * preference, so the guard lives next to the comparator instead of being
 * re-implemented per call site.
 */
export function isValidSessionSortOption(value: unknown): value is SessionSortOption {
  return typeof value === 'string' && (SESSION_SORT_OPTIONS as readonly string[]).includes(value);
}
