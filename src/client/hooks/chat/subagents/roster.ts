/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The roster of subagents one session ran, as data.
 *
 * Split out of the list component that used to draw subagents: the tree now
 * draws the rows, and it needs the same roster from the same two sources (the
 * transcript history on disk, plus the live frames for the session that is
 * open). Both passes are unchanged; only the consumer moved.
 */

import { useEffect, useState } from 'preact/hooks';
import { isRecord } from '@/shared/lib/util/guards';
import { fetchSubagentHistory, historyEntryToSubagentInfo } from '@/shared/lib/omp/subagent/history/client';
import {
  mergeSubagentRoster,
  parseSubagentLifecycle,
  parseSubagentRosterResponse,
  readSubagentProgressFrame,
} from '@/shared/lib/omp/subagent/parse';
import { subscribeSubagentFrame, type SubagentFrame } from '@/shared/lib/chat/omp/subagent-frames';
import type { SubagentInfo, SubagentProgress } from '@/shared/types';

export interface SubagentRoster {
  subagents: SubagentInfo[];
  isLoading: boolean;
}

const PROGRESS_STATUS: Record<NonNullable<SubagentProgress['status']>, SubagentInfo['status']> = {
  pending: 'started', running: 'started', completed: 'completed', failed: 'failed', aborted: 'aborted',
};

/** Fold one progress frame into the roster entry it names (id, else index). */
function applyProgress(roster: SubagentInfo[], progress: SubagentProgress): SubagentInfo[] {
  return roster.map((entry) => {
    if (progress.id !== undefined) {
      if (entry.id !== progress.id) return entry;
    } else if (progress.index === undefined || progress.index < 0 || entry.index !== progress.index) {
      return entry;
    }
    const status = progress.status && entry.status === 'started'
      ? PROGRESS_STATUS[progress.status] ?? entry.status
      : entry.status;
    return { ...entry, status, progress: { ...entry.progress, ...progress }, lastUpdate: Date.now() };
  });
}

/**
 * The roster for one session.
 *
 * `enabled` is the session's own `hasSubagents` flag: a branch opened for its
 * CHILD SESSIONS must not fire a roster read (history request plus a
 * `get_subagents` snapshot) that can only answer empty.
 */
export function useSubagentRoster(
  sessionId: string,
  isActiveSession: boolean,
  enabled: boolean,
): SubagentRoster {
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSubagents([]);
    setIsLoading(true);
    void fetchSubagentHistory(sessionId)
      .then((entries) => {
        if (cancelled || !entries) return;
        const roster = entries.map(historyEntryToSubagentInfo);
        setSubagents((prev) => mergeSubagentRoster(prev, roster));
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, enabled]);

  useEffect(() => {
    if (!enabled || !isActiveSession) return;
    let cancelled = false;
    const requestedAt = Date.now();
    const forThisSession = (frame: SubagentFrame) =>
      frame.sessionId === sessionId ? frame.payload : null;

    const unsubLifecycle = subscribeSubagentFrame('subagent_lifecycle', (frame) => {
      const entry = parseSubagentLifecycle(forThisSession(frame));
      if (entry) setSubagents((prev) => mergeSubagentRoster(prev, [entry]));
    });
    const unsubProgress = subscribeSubagentFrame('subagent_progress', (frame) => {
      const progress = readSubagentProgressFrame(forThisSession(frame));
      if (progress) setSubagents((prev) => applyProgress(prev, progress));
    });

    // Snapshot the LIVE registry. This POST is the spawn path, so the server
    // refuses it (409) for a session it does not manage — an observer read must
    // never boot an omp child. The history pass already covers a finished
    // session from disk, so nothing is missing when this comes back empty.
    fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'get_subagents' }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled || !isRecord(body)) return;
        const payload = 'data' in body ? body.data : body;
        setSubagents((prev) => mergeSubagentRoster(prev, parseSubagentRosterResponse(payload), requestedAt));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubLifecycle();
      unsubProgress();
    };
  }, [enabled, isActiveSession, sessionId]);

  return { subagents, isLoading };
}
