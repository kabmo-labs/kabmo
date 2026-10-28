/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Subscribe a component to one realtime topic.
 *
 * The reader every data-backed panel shares: the server pushes when a topic
 * changes, so a panel renders what it is handed instead of asking on a timer.
 *
 * Two rules carried over from the polling hooks it replaced, because they were
 * right:
 *
 *   - **`enabled: false` subscribes to nothing.** A hidden panel — or one whose
 *     session is not selected — must not keep a subscription alive, or the
 *     server would produce snapshots nobody renders.
 *   - **A topic switch drops the old value first.** The panel's topic encodes
 *     the session it describes, so rendering the previous session's data under
 *     the new title is the failure this prevents.
 *
 * `stale` is surfaced rather than hidden: it means the socket is down or a
 * sequence gap was seen, and a panel should say so instead of showing a value
 * of unknown age as if it were current.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { realtimeClient, type RealtimeStatus } from '@/shared/lib/realtime/client';

/**
 * How long a topic's refresh indicator stays lit after a frame lands.
 *
 * Long enough for the eye to catch a push it did not ask for, short enough that
 * a burst of frames does not leave the button spinning after the data settled.
 */
const REFRESH_PULSE_MS = 700;

export interface RealtimeTopicState<T> {
  data: T | null;
  /** No value has arrived yet for this topic. */
  isLoading: boolean;
  /**
   * A refresh is in flight, or one just landed: lit for a beat after EVERY
   * frame — a server push (a tool call advanced the topic) and the panel's own
   * `refresh` alike — so a toolbar button can spin and the user notices the
   * data moved. Distinct from `isLoading`, which is true only before the FIRST
   * value arrives.
   */
  refreshing: boolean;
  /** The value on hand is not known to be current. */
  stale: boolean;
  status: RealtimeStatus;
  /** Ask the server for a fresh snapshot (a panel's own Refresh). */
  refresh: () => void;
}

export function useRealtimeTopic<T>(
  topic: string | null,
  options: { enabled?: boolean } = {},
): RealtimeTopicState<T> {
  const { enabled = true } = options;
  const active = enabled && topic !== null;

  const [data, setData] = useState<T | null>(() => (topic ? realtimeClient.read<T>(topic) : null));
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<RealtimeStatus>(realtimeClient.status);
  // Lit while a refresh is in flight and for a beat after a frame lands, so a
  // toolbar button can spin for a push the user did not ask for.
  const [refreshing, setRefreshing] = useState(false);
  // `window.setTimeout` returns a number under the DOM lib, so the handle is a
  // plain number and the clear below needs no guard.
  const pulseTimer = useRef<number | undefined>(undefined);
  // The topic a render belongs to, so a late notification for the previous one
  // cannot repaint the panel that has moved on.
  const topicRef = useRef(topic);
  topicRef.current = topic;

  /** Light the indicator and (re)arm its trailing-off timer. */
  const pulse = useCallback(() => {
    setRefreshing(true);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => {
      pulseTimer.current = undefined;
      setRefreshing(false);
    }, REFRESH_PULSE_MS);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(pulseTimer.current);
  }, []);

  useEffect(() => {
    // A new topic is a new question: drop the previous answer before the
    // snapshot lands, or the old session's data renders under the new title.
    if (!active || topic === null) {
      setData(null);
      setStale(false);
      setRefreshing(false);
      return;
    }
    setData(realtimeClient.read<T>(topic));
    setStale(realtimeClient.isStale(topic));

    const listener = () => {
      const current = topicRef.current;
      if (current === null) return;
      setData(realtimeClient.read<T>(current));
      setStale(realtimeClient.isStale(current));
      // Every frame — a push from a tool call as much as this panel's own
      // request — means the value just moved; say so on the indicator.
      pulse();
    };
    const unsubscribe = realtimeClient.subscribe(topic, listener);
    return () => {
      unsubscribe();
    };
  }, [topic, active, pulse]);

  useEffect(() => realtimeClient.onStatus(() => setStatus(realtimeClient.status())), []);

  const refresh = useCallback(() => {
    if (topic === null) return;
    pulse();
    realtimeClient.refresh(topic);
  }, [topic, pulse]);

  return { data, isLoading: data === null, refreshing, stale, status, refresh };
}
