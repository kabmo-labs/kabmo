/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session's agent change journal, for the chat's per-run file list.
 *
 * Read on mount and again when a run settles. The mid-run read is deliberate:
 * the journal is written while the agent works, so the CURRENT run's records
 * are partial — but the settled runs' records are complete, and a reader who
 * opens a live session must still see their file lists. The current run's
 * partial records are bucketed into a run whose footer is not rendered yet, so
 * they do not show until the settle read. A failed read keeps the previous
 * list — a transient 500 is not a reason to blank a summary the reader is
 * looking at.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SessionChangeRecord } from '@/shared/types';

export function useSessionChanges(
  sessionId: string | null,
  isGenerating: boolean,
  enabled = true,
): SessionChangeRecord[] {
  const [records, setRecords] = useState<SessionChangeRecord[]>([]);

  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      return;
    }
    if (!sessionId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/changes`);
        const data = (await res.json().catch(() => null)) as { records?: SessionChangeRecord[] } | null;
        if (!cancelled && Array.isArray(data?.records)) setRecords(data.records);
      } catch {
        // Keep the previous list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, isGenerating, enabled]);

  return records;
}
