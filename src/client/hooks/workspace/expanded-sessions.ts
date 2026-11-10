/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Expanded-session branches, shared by the desktop and mobile session sidebars.
 *
 * One row has ONE branch — child sessions and its subagent roster — and one
 * chevron opens it. Both sidebars must read and write ONE set, persisted in
 * `app_settings.omp_sidebar_expanded_sessions`, or a branch expanded on the
 * phone comes back collapsed on the desktop.
 *
 * The `?subagent=` deep link auto-expands its session row: a reload on a
 * subagent transcript must leave the leaf that opened it visible.
 *
 * A pending CHILD (the row a "New child session" click creates) also opens its
 * parent through `expandSessionBranch`, because the row would otherwise exist
 * inside a collapsed branch and never be seen.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { loadExpandedSessionIds, saveExpandedSessionIds } from '@/shared/lib/workspace/sidebar-expanded';

/** Fired by a pending child's creator so every sidebar opens its parent. */
const EXPAND_SESSION_EVENT = 'omp:expand-session';

export interface ExpandedSessionsHandle {
  expandedSessionIds: Set<string>;
  /** Collapse an expanded branch, or expand a collapsed one. Persists it. */
  toggleSession: (sessionId: string) => void;
}

/** Open one session's branch from outside the sidebar (a pending child). */
export function expandSessionBranch(sessionId: string): void {
  if (typeof window === 'undefined' || !sessionId) return;
  window.dispatchEvent(new CustomEvent(EXPAND_SESSION_EVENT, { detail: { sessionId } }));
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

  useEffect(() => {
    const onExpand = (event: Event) => {
      const id = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!id) return;
      setExpandedSessionIds(prev => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        saveExpandedSessionIds(next);
        return next;
      });
    };
    window.addEventListener(EXPAND_SESSION_EVENT, onExpand);
    return () => window.removeEventListener(EXPAND_SESSION_EVENT, onExpand);
  }, []);

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
