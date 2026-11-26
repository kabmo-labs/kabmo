/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff panel's read for a journal tab: the agent's own before/after
 * snapshots for one path inside one run window.
 *
 * Same shape as {@link useFileDiff} so the panel can swap the source without a
 * second renderer. The two differences are the endpoint and the status
 * vocabulary: the journal answers `added` / `modified` / `deleted`, which the
 * panel's badge already understands as `A` / `M` / `D`.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FileDiffState } from '@/client/hooks/workspace/diff-file';
import { journalUnavailableMessage } from '@/shared/lib/fs/journal-unavailable';
import type { JournalDiffRef } from '@kabmo-labs/kabmo-app-contracts/fs';
import type { SessionChangeUnavailableReason } from '@kabmo-labs/kabmo-omp-contracts/session-changes';

interface JournalDiffResponse {
  success?: boolean;
  oldContent?: string;
  newContent?: string;
  diff?: string;
  status?: 'added' | 'modified' | 'deleted';
  unavailable?: boolean;
  unavailableReason?: SessionChangeUnavailableReason;
  unavailableLimitBytes?: number;
  error?: string;
}

/** `A` / `M` / `D` for the panel's status badge. */
function statusLetter(status: JournalDiffResponse['status']): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

export function useJournalDiff(ref: JournalDiffRef | undefined): FileDiffState {
  const [rawDiff, setRawDiff] = useState('');
  const [oldContent, setOldContent] = useState('');
  const [newContent, setNewContent] = useState('');
  const [currentStatus, setCurrentStatus] = useState('M');
  const [isLoading, setIsLoading] = useState(Boolean(ref));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const seqRef = useRef(0);

  const sessionId = ref?.sessionId;
  const path = ref?.path;
  const from = ref?.from;
  const to = ref?.to;

  const fetchDiff = useCallback(async () => {
    if (!sessionId || !path || from === undefined || to === undefined) return;
    const seq = ++seqRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({ path, from: String(from), to: String(to) });
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/changes/diff?${params.toString()}`);
      const data = (await res.json().catch(() => null)) as JournalDiffResponse | null;
      if (seq !== seqRef.current) return;
      if (data?.success) {
        setOldContent(data.oldContent ?? '');
        setNewContent(data.newContent ?? '');
        setRawDiff(data.diff ?? '');
        setCurrentStatus(statusLetter(data.status));
        if (data.unavailable) {
          setErrorMessage(journalUnavailableMessage({
            reason: data.unavailableReason,
            limitBytes: data.unavailableLimitBytes,
          }));
        }
      } else {
        setErrorMessage(data?.error || `Failed to load the journal diff (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      if (seq !== seqRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Error fetching the journal diff');
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, [sessionId, path, from, to]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  const adoptState = useCallback(() => {}, []);

  return {
    rawDiff,
    oldContent,
    newContent,
    currentStatus,
    currentStaged: false,
    isLoading,
    errorMessage,
    fetchDiff,
    adoptState,
  };
}
