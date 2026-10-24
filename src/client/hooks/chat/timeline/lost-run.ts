/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recover a run whose terminal frames were lost with the realtime channel.
 *
 * The reported failure: a streaming chat was left in a background tab, the
 * socket was torn down, the turn finished while nothing was reading, and the
 * user came back to an answer cut off mid-sentence with the docked indicator
 * already gone. Both halves of that state come from the same missing frames —
 * `message_end` never replaced the streaming row, and `agent_end` never
 * released the local generating flag — while the SERVER's `stream` row settled
 * normally, which is why the indicator stopped but the transcript did not.
 *
 * The trigger is the channel reopening while this page still believes a run is
 * live (`useReconnectSettle`, which also asks the server whether the run is
 * really over). Recovery is two steps and both are needed:
 *
 * 1. settle the local run — release the generating flag and drop the ids that
 *    only a live stream would consume (the AI placeholder, the optimistic user
 *    mark, pending steer displays);
 * 2. re-read the committed transcript, because the rows on screen are the
 *    stream's last PARTIAL segment and the session JSONL is the only record of
 *    the rest.
 *
 * The reload is deliberately unconditional about ownership: a run this page
 * dispatched is over by the time this fires, so the guard in `session-load.ts`
 * (which exists to keep a LAGGING snapshot away from a live run) does not
 * apply here.
 *
 * A run that is STILL LIVE at reconnect is a different case and is NOT
 * reloaded here — its rows are the stream's, and replacing them mid-turn is the
 * lagging-snapshot bug the guard exists for. But its earlier segments are gone:
 * their `message_end` went into the dead socket, and `agent_end` only
 * materializes turns that stopped abnormally (`materializeTerminalMessages`).
 * So the loss is REMEMBERED (`needsReloadRef`) and the transcript is re-read
 * when the run settles, which is the only point where a full read is safe.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import { useCallback, useRef } from 'preact/hooks';

import { SESSION_META_RETRY_SCHEDULE_MS } from '@/shared/lib/workspace/refresh-cadence';
import type { ChatMessageData } from '@/shared/types';
import { useReconnectSettle } from '@/client/hooks/chat/omp/reconnect';

export interface LostRunRecoveryDeps {
  sessionId: string | null;
  sessionIdRef: { current: string | null };
  /** The id a spawn adopted, while the URL still carries the pending one. */
  adoptedSessionIdRef: { current: string | null };
  isGeneratingRef: { current: boolean };
  /** The stream has announced the run in flight — see `useReconnectSettle`. */
  streamRunRef: { current: boolean };
  /** The server reports a run for this session (its `stream` row). */
  serverRunRef: { current: boolean };
  setGenerating: (v: boolean) => void;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** Pagination cursor for the window the reload applies. */
  applyWindow: (hasMore: unknown, oldestIndex: unknown) => void;
  aiPlaceholderIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  pendingUserDisplaysRef: { current: { sent: string; display: string }[] };
  cancelStreamingCoalescer: () => void;
}

export interface LostRunRecovery {
  /** Re-read the committed transcript now (used by the run's own settle path
   *  when `needsReloadRef` is set — see `omp-callbacks.ts`). */
  reloadMessages: () => void;
  /** Set when a run that lost frames is still streaming: its earlier segments
   *  can only be recovered by a full read once the run is over. */
  needsReloadRef: { current: boolean };
}

export function useLostRunRecovery(deps: LostRunRecoveryDeps): LostRunRecovery {
  const {
    sessionId,
    sessionIdRef,
    adoptedSessionIdRef,
    isGeneratingRef,
    streamRunRef,
    serverRunRef,
    setGenerating,
    setLocalMessages,
    applyWindow,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    cancelStreamingCoalescer,
  } = deps;

  /** Replace the timeline with the session's committed transcript.
   *
   *  A FAILED read leaves the rows alone. An EMPTY one is retried on the same
   *  front-loaded schedule `refreshSessionMeta` uses, and for the same reason:
   *  omp buffers its transcript writes, so the turn that just finished may not
   *  be on disk yet when the channel comes back — reading once and stopping
   *  would leave the partial answer in place, which is the very state this
   *  recovery exists to clear. The retry is bounded and stops at the first
   *  non-empty answer. */
  const reloadMessages = useCallback(() => {
    const current = sessionIdRef.current;
    // A spawn answers with omp's id a beat before the URL carries it, so the
    // adopted id is the one with a transcript when the pending id is still in
    // the URL.
    const target = current && !current.startsWith('new-')
      ? current
      : adoptedSessionIdRef.current;
    if (!target) return;
    let attempt = 0;
    const tryRead = (): void => {
      fetch(`/api/chat/${encodeURIComponent(target)}`)
        .then(res => res.json())
        .then(data => {
          // The session may have moved while the read was in flight; applying
          // it would paint one conversation's rows into another.
          const now = sessionIdRef.current;
          if (now !== target && adoptedSessionIdRef.current !== target) return;
          if (!data?.session) return;
          const fetched: ChatMessageData[] = data.session.messages || [];
          if (fetched.length > 0) {
            setLocalMessages(fetched);
            applyWindow(data.hasMore, data.oldestIndex);
            return;
          }
          const delay = SESSION_META_RETRY_SCHEDULE_MS[attempt];
          attempt += 1;
          if (delay !== undefined) setTimeout(tryRead, delay);
        })
        .catch(() => {});
    };
    tryRead();
  }, [sessionIdRef, adoptedSessionIdRef, setLocalMessages, applyWindow]);

  const needsReloadRef = useRef(false);

  useReconnectSettle({
    // A pending `new-…` chat has no omp child and no committed transcript: its
    // run is covered by the pending view, and settling it here would drop the
    // optimistic rows of a spawn still in flight.
    sessionId: sessionId?.startsWith('new-') ? null : sessionId,
    isGeneratingRef,
    streamRunRef,
    serverRunRef,
    // Recorded at the DROP: the segments that finished during the outage have
    // no other way back, and the read that recovers them is only safe once the
    // run is over — so the flag is consumed by `onAgentEnd` (`omp-callbacks.ts`)
    // rather than read here.
    onFramesLost: () => { needsReloadRef.current = true; },
    onSettled: () => {
      setGenerating(false);
      // Queued updates are the same lost segment's tail: the reload is
      // authoritative, and applying them would paint a partial answer over the
      // committed one.
      cancelStreamingCoalescer();
      optimisticUserIdRef.current = null;
      pendingUserDisplaysRef.current = [];
      // The placeholder mark is released, but its ROW is not deleted here: the
      // committed read below is what replaces the rows, and dropping the only
      // row first would blank the transcript for the retry window — and leave
      // it blank for good if omp never flushed the turn. A row the stream left
      // mid-flight also carries `thinking.isGenerating`, which is what pulses
      // the collapsed accordion; the run is over, so nothing is generating.
      aiPlaceholderIdRef.current = null;
      setLocalMessages(prev => prev.map(m => (typeof m.thinking === 'object' && m.thinking?.isGenerating
        ? { ...m, thinking: { ...m.thinking, isGenerating: false } }
        : m)));
      needsReloadRef.current = false;
      reloadMessages();
    },
  });

  return { reloadMessages, needsReloadRef };
}
