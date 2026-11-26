/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's harness filter: which agent ran the chat.
 *
 * A harness is a SPAWN-time fact (`SessionItemData.harness`), so this is a
 * filter over rows the server already sent — never a second query. A workspace
 * with nothing left to show is dropped rather than drawn as an empty header,
 * the same rule the search and focus filters follow.
 *
 * The options are counted over the UNFILTERED list, so an entry's number is a
 * fact about the workspace rather than about what the current filter shows.
 * That is what makes "3 claude" still readable while the list is narrowed to
 * `codex`.
 *
 * A row with no harness (a session created before harnesses were tracked, or a
 * MOCK row) belongs to no entry: inventing `omp-rpc` for it would claim a
 * transport the row itself refuses to draw. It stays reachable through `All`.
 */

import { harnessBadgeLabel } from '@kabmo-labs/kabmo-harness/catalog';
import type { WorkspaceFolderData } from '@/shared/types';

/** A harness id, or `null` for every harness. */
export type HarnessFilter = string | null;

export interface HarnessFilterOption {
  harness: string;
  /** The name a human reads (`omp`, `claude`, …). */
  label: string;
  /** Rows this harness owns in the unfiltered list. */
  count: number;
}

/**
 * The menu entries, most-used first.
 *
 * Ordering by count puts the agent the user actually works on at the top, where
 * the eye lands; the label breaks ties so two harnesses with one row each do not
 * swap places between renders.
 */
export function harnessFilterOptions(folders: readonly WorkspaceFolderData[]): HarnessFilterOption[] {
  const counts = new Map<string, number>();
  for (const folder of folders) {
    for (const session of folder.sessions) {
      if (!session.harness) continue;
      counts.set(session.harness, (counts.get(session.harness) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([harness, count]) => ({ harness, label: harnessBadgeLabel(harness), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The folders a harness filter offers.
 *
 * `null` returns the input untouched — the caller compares by identity to know
 * whether it has to re-expand anything.
 */
export function harnessFilterFolders(
  folders: readonly WorkspaceFolderData[],
  filter: HarnessFilter,
): WorkspaceFolderData[] {
  if (!filter) return folders as WorkspaceFolderData[];
  return folders
    .map((folder) => ({
      ...folder,
      sessions: folder.sessions.filter((session) => session.harness === filter),
    }))
    .filter((folder) => folder.sessions.length > 0);
}
