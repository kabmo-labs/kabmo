/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Is a run in flight for this chat?" — the one derivation the whole timeline
 * reads, and the two windows the server's row cannot cover.
 *
 * Its base is the SERVER: the `stream` row written at prompt dispatch, published
 * on the `sidebar:status` topic the sidebar's spinner is drawn from — so no
 * consumer (indicator, streaming row, withheld run footer, queue-vs-send, Stop)
 * can disagree with the sidebar.
 *
 * Two windows the row cannot cover, and BOTH must be reported or a run reads as
 * already settled while it is still starting:
 *
 *  1. a pending `new-…` chat has no omp id until the spawn answers, so no row
 *     can ever carry it;
 *  2. a run THIS PAGE dispatched, in the beat between the send arming the
 *     optimistic rows and the row reaching this client over the topic —
 *     measured ~120-250 ms, and the reason the run footer "appeared for an
 *     instant" on every prompt: handed `isGenerating: false` for that window,
 *     `resolveRunFooters` settled the run and painted a model/duration footer
 *     over the EMPTY placeholder row, then withdrew it when the row arrived.
 *
 * The second term is `ownRun` — armed by the SEND path alone, released by the
 * same settle paths as the run — NOT a raw local flag: an ADOPTED run (the mount
 * probe resuming a live run's UI) leaves it alone, so a run this page did not
 * start is still reported by the server row and never by client state.
 */

import { useRef } from 'preact/hooks';
import { isChatRunning, isSessionStreaming } from '@/client/hooks/chat/omp/session-statuses';

export interface TimelineRunning {
  /** Whether the chat has a run in flight, for every consumer's use. */
  running: boolean;
  /**
   * SERVER evidence a prompt was dispatched (the `stream` row), mirrored for the
   * reconnect guard: a run whose FIRST frame was lost has no `agent_start`.
   */
  serverRunRef: { current: boolean };
}

export function useTimelineRunning(
  streamStatusMap: Record<string, 'stream' | 'finish' | 'abort'>,
  sessionId: string | null,
  ownRun: boolean,
): TimelineRunning {
  const serverRun = isSessionStreaming(streamStatusMap, sessionId);
  const serverRunRef = useRef(serverRun);
  serverRunRef.current = serverRun;
  return { running: isChatRunning(streamStatusMap, sessionId, ownRun), serverRunRef };
}
