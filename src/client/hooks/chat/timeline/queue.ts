/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client view of the follow-up queue (SQLite `queued_messages`, owned by the
 * server). The panel is a VIEW: mutations go through the per-item endpoints
 * (`POST/PATCH/DELETE /api/sessions/:id/queue[/:itemId]`) and every response
 * carries the canonical queue, which replaces local state wholesale. The old
 * client-side replace-on-write mirror is gone — it was what let a reload
 * hydrating over an empty state wipe the table, and a session switch PUT one
 * session's list into another's rows.
 *
 * There is no steering queue here. There used to be a client-only mirror
 * (`chat.steeringQueue`) with no writer at all: nothing ever appended to it,
 * because a steer is fire-and-forget (`abort_and_prompt`) and produces no
 * pending row to display. It is removed rather than left as a dead panel.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { QueuedMessage } from '@/shared/types';
import { clearSessionKey } from '@/shared/lib/workspace/session-state/store';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { sessionQueueTopic } from '@/shared/lib/realtime/protocol';

/**
 * The retired client-only steering mirror. Nothing ever appended to it, so it
 * only ever held `[]` — but the whole per-session state blob is POSTed on every
 * write, so the key rode along in 108 stored sessions. Dropped once per mount;
 * `clearSessionKey` is a no-op when the key is already gone.
 */
const LEGACY_STEERING_STATE_KEY = 'chat.steeringQueue';

/**
 * How often a mounted session with a non-empty queue re-offers a delivery slot.
 *
 * This is the safety net for a server whose own timers have stopped firing: a
 * long-lived `bun --hot` process can stop running `setTimeout` callbacks
 * entirely while still answering HTTP normally (observed live — a 4-hour dev
 * server whose SSE heartbeat never fired and whose queued follow-ups never
 * drained, while every request returned in 0.01s). Auto-delivery is timer-driven
 * server-side, so it dies with those timers; a client poll runs in a different
 * process and is immune.
 *
 * Only armed while something is actually queued, and each tick is one POST that
 * doubles as the panel's reconcile, so an idle session costs nothing. 3s is a
 * deliberate compromise: slow enough to be invisible on the wire, fast enough
 * that a stranded item lands before the user wonders about it.
 */
const QUEUE_POLL_INTERVAL_MS = 3_000;

function queueUrl(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/queue`;
}

async function readQueueResponse(res: Response): Promise<QueuedMessage[] | null> {
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { queue?: unknown } | null;
  return Array.isArray(data?.queue) ? (data.queue as QueuedMessage[]) : null;
}

export interface ChatTimelineQueueResult {
  messageQueue: QueuedMessage[];
  /** Append one item; local state updates optimistically, then reconciles
   *  from the canonical response. No-op without a session. */
  enqueueMessage: (item: Omit<QueuedMessage, 'id'>) => void;
  /** Edit one item's text (PATCH). */
  editMessageText: (id: string, text: string) => void;
  /** Remove one item by id (DELETE). */
  removeMessage: (id: string) => void;
  /** Reorder the queue to these ids (PUT, drag-and-drop). */
  reorderMessages: (orderedIds: string[]) => void;
  /** Replace the local list from a fetch (mount hydration, manual refresh). */
  refresh: () => void;
}

export function useChatTimelineQueue(sessionId: string | null): ChatTimelineQueueResult {
  const [messageQueue, setMessageQueueState] = useState<QueuedMessage[]>([]);

  /**
   * The queue rides `session:<id>:queue`: every write (this tab's, a second
   * tab's, the server's own claim for delivery) republishes it, so the panel
   * reconciles from the server instead of only from its own mutation responses.
   * The HTTP `refresh` below stays as the mount read and the manual fallback —
   * a topic with no resolver (MOCK) answers nothing.
   */
  const queueTopic = useRealtimeTopic<QueuedMessage[]>(
    sessionId ? sessionQueueTopic(sessionId) : null,
  );
  useEffect(() => {
    const pushed = queueTopic.data;
    if (!Array.isArray(pushed)) return;
    setMessageQueueState(pushed);
  }, [queueTopic.data]);

  // Hydrate from the table once per session, and re-read when the tab
  // regains focus (a second tab may have claimed/delivered the head). A
  // generation-safe ref skips the stale-response race on quick switches.
  const hydrateEpochRef = useRef(0);
  const cancelledRef = useRef(false);
  const refresh = useCallback(() => {
    if (!sessionId) {
      setMessageQueueState([]);
      return;
    }
    // A manual refresh asks the topic too: the server's answer and the HTTP
    // one are the same reader, so both paths converge.
    queueTopic.refresh();
    const epoch = ++hydrateEpochRef.current;
    fetch(queueUrl(sessionId))
      .then((res) => readQueueResponse(res))
      .then((queue) => {
        if (cancelledRef.current || hydrateEpochRef.current !== epoch) return;
        setMessageQueueState(queue ?? []);
      })
      .catch(() => {});
  }, [sessionId, queueTopic.refresh]);
  // Offer the server a delivery slot for this session. The server-side claim
  // makes this harmless when a run is active or another tab already took the
  // head — this used to be the client auto-delivery effect, which fired into
  // whatever session was open at the time.
  //
  // The response carries the canonical queue, so this doubles as a reconcile.
  const nudgeDelivery = useCallback(() => {
    if (!sessionId) return;
    const epoch = hydrateEpochRef.current;
    fetch(`${queueUrl(sessionId)}/deliver`, { method: 'POST' })
      .then((res) => readQueueResponse(res))
      .then((queue) => {
        // Only reconcile when this is still the session on screen: the poll can
        // outlive a switch, and writing another session's queue here is the
        // exact cross-session bug the server-owned store was built to stop.
        if (cancelledRef.current || hydrateEpochRef.current !== epoch) return;
        if (queue) setMessageQueueState(queue);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    // One-time: drop the retired steering mirror so the stored blob stops
    // carrying it. Idempotent — `clearSessionKey` returns when the key is gone.
    clearSessionKey(sessionId, LEGACY_STEERING_STATE_KEY);
    refresh();
    // Mount and every focus regain offer a delivery slot. Focus is the trigger
    // the recovery path depends on, so it must re-nudge even when the queue
    // length is unchanged: keying this on `messageQueue.length > 0` (a boolean
    // that stays true while the item is stranded) meant the effect never re-ran
    // and a stuck queue stayed stuck.
    nudgeDelivery();
    const onFocus = () => {
      refresh();
      nudgeDelivery();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelledRef.current = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, nudgeDelivery]);

  // Items appearing while the session is already mounted (a send while
  // streaming, or another tab's write): offer a slot without waiting for focus.
  useEffect(() => {
    if (messageQueue.length > 0) nudgeDelivery();
  }, [messageQueue.length, nudgeDelivery]);

  // Safety net: while anything is queued, keep offering a slot on an interval.
  // Server-side auto-delivery is timer-driven and a long-lived `--hot` server
  // can lose that capability silently; this poll lives in the browser and is
  // unaffected. The effect is torn down the moment the queue empties, so a
  // session with nothing queued never polls.
  const hasQueued = messageQueue.length > 0;
  useEffect(() => {
    if (!sessionId || !hasQueued) return;
    const timer = setInterval(nudgeDelivery, QUEUE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sessionId, hasQueued, nudgeDelivery]);

  const enqueueMessage = useCallback((item: Omit<QueuedMessage, 'id'>) => {
    if (!sessionId) return;
    const optimistic: QueuedMessage = { ...item, id: `queue-${Date.now()}` };
    setMessageQueueState((prev) => [...prev, optimistic]);
    fetch(queueUrl(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
      .then((res) => readQueueResponse(res))
      .then((queue) => { if (queue) setMessageQueueState(queue); })
      .catch(() => {});
  }, [sessionId]);

  const editMessageText = useCallback((id: string, text: string) => {
    if (!sessionId) return;
    fetch(`${queueUrl(sessionId)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => readQueueResponse(res))
      .then((queue) => { if (queue) setMessageQueueState(queue); })
      .catch(() => {});
  }, [sessionId]);

  const removeMessage = useCallback((id: string) => {
    if (!sessionId) return;
    // Optimistic removal, reconciled only on failure (404 = already claimed —
    // the item is gone either way).
    setMessageQueueState((prev) => prev.filter((i) => i.id !== id));
    fetch(`${queueUrl(sessionId)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((res) => readQueueResponse(res))
      .then((queue) => { if (queue) setMessageQueueState(queue); })
      .catch(() => {});
  }, [sessionId]);

  const reorderMessages = useCallback((orderedIds: string[]) => {
    if (!sessionId) return;
    setMessageQueueState((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      return orderedIds.map((id) => byId.get(id)).filter((i): i is QueuedMessage => Boolean(i));
    });
    fetch(queueUrl(sessionId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
      .then((res) => readQueueResponse(res))
      .then((queue) => { if (queue) setMessageQueueState(queue); })
      .catch(() => {});
  }, [sessionId]);

  return { messageQueue, enqueueMessage, editMessageText, removeMessage, reorderMessages, refresh };
}
