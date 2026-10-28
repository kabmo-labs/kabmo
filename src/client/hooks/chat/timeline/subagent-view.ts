/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Subagent transcript navigation for the chat timeline: which transcript is
 * open, how a roster click opens one, and how the `?subagent=<id>` deep link is
 * restored after a reload.
 *
 * The view is URL-addressable so a reload keeps it, but the SubagentInfo body
 * only lives in state — a deep-linked or hydrated entry is therefore
 * reconstructed from the history route, where a finished subagent is always
 * recoverable. Extracted from ChatTimeline so that component stays under the
 * repo's per-file size ceiling.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { isRecord } from '@/shared/lib/util/guards';
import { historyEntryToSubagentInfo } from '@/shared/lib/omp/subagent/history/client';
import type { SubagentHistoryEntry, SubagentInfo } from '@/shared/types';

export interface SubagentViewState {
  /** Transcript currently open, or null for the main timeline. */
  activeSubagent: SubagentInfo | null;
  /** Back paths (banner button / Escape): clears state and the URL param. */
  back: () => void;
}

export function useSubagentView(
  sessionId: string | null,
  urlSubagentId: string | null,
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams, opts?: { replace?: boolean }) => void,
): SubagentViewState {
  const [activeSubagent, setActiveSubagent] = useState<SubagentInfo | null>(null);

  // Roster clicks open the transcript; when the row belongs to another
  // session, the same update navigates there — a click must never be a no-op.
  useEffect(() => {
    const handleViewSubagentEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; subagent?: SubagentInfo }>).detail;
      const subagent = detail?.subagent;
      const detailSessionId = detail?.sessionId;
      if (!subagent || !detailSessionId) return;
      setActiveSubagent(subagent);
      setSearchParams(prev => {
        if (prev.get('sessionId') === detailSessionId && prev.get('subagent') === subagent.id) return prev;
        prev.set('sessionId', detailSessionId);
        prev.set('subagent', subagent.id);
        return prev;
      }, { replace: false });
    };
    window.addEventListener('omp:view-subagent', handleViewSubagentEvent);
    return () => window.removeEventListener('omp:view-subagent', handleViewSubagentEvent);
  }, [setSearchParams]);

  // The ?subagent param drives the view: absent → main timeline (covers
  // session switches and back navigation); present → the transcript.
  useEffect(() => {
    if (!urlSubagentId) {
      setActiveSubagent(null);
      return;
    }
    if (activeSubagent?.id === urlSubagentId) return;
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/subagents`)
      .then(res => (res.ok ? res.json() : null))
      .then((body: { subagents?: unknown[] } | null) => {
        if (cancelled || !body?.subagents) return;
        const entry = body.subagents.find(s => isRecord(s) && s.id === urlSubagentId);
        if (!entry) return;
        setActiveSubagent(historyEntryToSubagentInfo(entry as SubagentHistoryEntry));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // activeSubagent is intentionally not a dep: the guard above only needs
    // the current render's value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, urlSubagentId]);

  const back = useCallback(() => {
    setActiveSubagent(null);
    setSearchParams(prev => {
      if (!prev.has('subagent')) return prev;
      prev.delete('subagent');
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  return { activeSubagent, back };
}
