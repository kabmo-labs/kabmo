/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The find bar's recent queries.
 *
 * Persisted per session like the query itself — a reload should not forget the string
 * you were hunting for — and bounded, because a long editing session would otherwise
 * keep every search it ever ran.
 *
 * A query is remembered when it was actually USED (the bar closing, or a history entry
 * being picked again), not when it was typed: a half-written regex that never ran is
 * noise in a list whose whole value is that each entry is something you searched for.
 */

import { useCallback } from 'preact/hooks';

import { useSessionState } from '@/client/hooks/workspace/session-state';

/** How many recent queries the bar remembers. */
export const FIND_HISTORY_LIMIT = 20;

export interface FindHistory {
  entries: readonly string[];
  /** Record a query as the most recent, without duplicating it. */
  remember: (query: string) => void;
}

export function useFindHistory(): FindHistory {
  const [entries, setEntries] = useSessionState<string[]>('editor.findHistory', []);

  const remember = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setEntries((previous) =>
        [trimmed, ...previous.filter((entry) => entry !== trimmed)].slice(0, FIND_HISTORY_LIMIT),
      );
    },
    [setEntries],
  );

  return { entries, remember };
}
