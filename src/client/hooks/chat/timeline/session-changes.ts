/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session's agent change journal, for the chat's per-run file list.
 *
 * Read once per settled run: the journal is written while the agent works, so
 * asking mid-run would show a partial list that then changes under the reader.
 * A failed read keeps the previous list — a transient 500 is not a reason to
 * blank a summary the reader is looking at.
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
    if (isGenerating) return;
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
