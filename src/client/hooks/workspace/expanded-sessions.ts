/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Expanded-session rows, shared by the desktop and mobile session sidebars.
 *
 * A session row's roster (its `SubagentList`) is shown while that row's id is
 * in the expanded set, so both sidebars must read and write ONE set — persisted
 * in `app_settings.omp_sidebar_expanded_sessions` — or a row expanded on the
 * phone would come back collapsed on the desktop.
 *
 * The `?subagent=` deep link auto-expands its session row: a reload on a
 * subagent transcript must leave the roster entry that opened it visible.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { loadExpandedSessionIds, saveExpandedSessionIds } from '@/shared/lib/workspace/sidebar-expanded';

export interface ExpandedSessionsHandle {
  expandedSessionIds: Set<string>;
  /** Collapse an expanded row, or expand a collapsed one. Persists the result. */
  toggleSession: (sessionId: string) => void;
}

export function useExpandedSessions(): ExpandedSessionsHandle {
  const [searchParams] = useSearchParams();
  const urlSubagentId = searchParams.get('subagent');
  const urlSessionId = searchParams.get('sessionId');
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const saved = loadExpandedSessionIds();
    if (saved && saved.size > 0) {
      setExpandedSessionIds(saved);
    }
  }, []);

  useEffect(() => {
    if (!urlSubagentId || !urlSessionId) return;
    setExpandedSessionIds(prev => {
      if (prev.has(urlSessionId)) return prev;
      const next = new Set(prev);
      next.add(urlSessionId);
      return next;
    });
  }, [urlSubagentId, urlSessionId]);

  const toggleSession = useCallback((sessionId: string) => {
    setExpandedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      saveExpandedSessionIds(next);
      return next;
    });
  }, []);

  return { expandedSessionIds, toggleSession };
}
