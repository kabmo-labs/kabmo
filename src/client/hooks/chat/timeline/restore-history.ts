/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client half of an IMPORTED chat's first open.
 *
 * The sidebar lists a chat the agent already held, but Kabmo has no transcript
 * for it: the loader answers `restore: true` and the server's restore command
 * resumes the agent with `replayFrom`, reduces the replayed frames and persists
 * them. This hook asks for that once per mount, then re-reads through the
 * ordinary loader — the timeline never grows a second fetch shape.
 *
 * A refusal becomes a visible notice row. An empty timeline over a failed
 * restore is the "my chat is gone" report this feature must not produce.
 */

import { useCallback, useRef } from 'preact/hooks';
import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';

export interface RestoreHistoryDeps {
  reloadMessages: () => void;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
}

export function useRestoreHistory({ reloadMessages, setLocalMessages }: RestoreHistoryDeps): (sessionId: string) => Promise<void> {
  /** Sessions this mount already asked to replay: a refused restore (a signed
   *  out agent) must not spawn an agent on every re-render. Re-opening retries. */
  const attempted = useRef<Set<string>>(new Set());

  return useCallback(async (sessionId: string) => {
    if (!sessionId || attempted.current.has(sessionId)) return;
    attempted.current.add(sessionId);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'restore' }),
      });
      const payload = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error ?? `History could not be restored (HTTP ${response.status})`);
      }
      reloadMessages();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'History could not be restored';
      setLocalMessages((prev) => [
        ...prev,
        { id: `restore-error-${sessionId}`, role: 'ai', content: '', notice: message },
      ]);
    }
  }, [reloadMessages, setLocalMessages]);
}
