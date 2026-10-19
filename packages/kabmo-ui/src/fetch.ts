/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetching Kabmo's HTTP API from a plugin panel.
 *
 * A plugin cannot import Kabmo's hooks, so this is the one place it
 * reaches the server: `GET /api/...` with the session's cookie, plus the three
 * behaviours every built-in panel hand-rolled and a plugin would get wrong —
 *
 * - **Polling that pauses while hidden.** A background tab cannot render the
 *   result, so each tick would be wasted work (and on mobile it keeps waking the
 *   CPU). A visibilitychange back to visible re-reads at once, so the panel is
 *   never stale when the user returns.
 * - **A guard against overlapping reads.** A panel's fetcher aborts its previous
 *   request whenever a new one starts, so an unguarded tick would cancel every
 *   slow read before it could finish and the panel would sit on "loading"
 *   forever.
 * - **Event-driven re-reads.** Name the window events your panel should follow
 *   and the hook re-reads on each, coalescing a burst through a throttle.
 *
 * The Kabmo's own views do NOT use this — they read the unified realtime
 * socket (`useRealtimeTopic`), which is not part of the kit's surface. This
 * stays for a plugin that reaches an HTTP endpoint directly.
 *
 * A response for a request the user has already moved past is DROPPED: the
 * hook keeps a sequence number, and a late answer never overwrites a newer one.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/** How often a visible panel re-reads by default. */
export const DEFAULT_POLL_MS = 5_000;

export interface KabmoFetchOptions {
  /** False while the view is hidden: no poll, no event listener. */
  enabled?: boolean;
  /** Poll cadence in ms. `0` disables polling and keeps the event path. */
  pollMs?: number;
  /** Window events that re-read, throttled by `eventThrottleMs`. */
  events?: readonly string[];
  /** Coalescing window for the event path. */
  eventThrottleMs?: number;
  /** Skip the fetch entirely (a request that cannot be built yet). */
  skip?: boolean;
}

export interface KabmoFetchState<T> {
  data: T | null;
  isLoading: boolean;
  /** Set when the last read failed; the previous payload is kept meanwhile. */
  error: string | null;
  /** Re-read now, ignoring the poll cadence. */
  reload: () => void;
}

/**
 * Read a Kabmo API path, re-reading on a poll and on the given events.
 *
 * `url` is a FULL path rather than a builder, because a caller that changes the
 * query — a session switch, a picked plan — must also change the request, and
 * rebuilding the URL is how the hook knows to drop the old answer and read
 * again.
 */
export function useKabmoFetch<T>(url: string | null, options: KabmoFetchOptions = {}): KabmoFetchState<T> {
  const { enabled = true, pollMs = DEFAULT_POLL_MS, events, eventThrottleMs = 400, skip = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest url for the fetcher, so a caller that rebuilds it every render does
  // not tear down the poll interval each time.
  const urlRef = useRef(url);
  urlRef.current = url;
  // Guards against a response for a request the user has already left being
  // written into the panel that now shows another.
  const requestRef = useRef(0);
  const active = enabled && !skip && url !== null;

  const load = useCallback(() => {
    const target = urlRef.current;
    if (!target) return;
    const seq = ++requestRef.current;
    setIsLoading(true);
    fetch(target, { credentials: 'same-origin' })
      .then(async (response) => {
        if (seq !== requestRef.current) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }
        const payload = (await response.json()) as T;
        if (seq !== requestRef.current) return;
        setData(payload);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (seq !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (seq !== requestRef.current) return;
        setIsLoading(false);
      });
  }, []);

  // A new URL is a new question: drop the old payload so the previous session's
  // answer cannot render under the new title, then read.
  useEffect(() => {
    setData(null);
    setError(null);
    if (active) load();
  }, [url, active, load]);

  useEffect(() => {
    if (!active || pollMs <= 0) return;
    let visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    let inFlight = false;
    const id = setInterval(() => {
      if (visible && !inFlight) {
        inFlight = true;
        Promise.resolve(load()).finally(() => {
          inFlight = false;
        });
      }
    }, pollMs);
    const onVisibility = () => {
      const next = document.visibilityState === 'visible';
      if (next && !visible) load();
      visible = next;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, pollMs, load]);

  const throttleRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!active || !events || events.length === 0) return;
    const schedule = () => {
      window.clearTimeout(throttleRef.current);
      throttleRef.current = window.setTimeout(load, eventThrottleMs);
    };
    for (const name of events) window.addEventListener(name, schedule);
    return () => {
      for (const name of events) window.removeEventListener(name, schedule);
      window.clearTimeout(throttleRef.current);
    };
  }, [active, events, eventThrottleMs, load]);

  useEffect(() => () => window.clearTimeout(throttleRef.current), []);

  return { data, isLoading, error, reload: load };
}

/**
 * @deprecated Use `useKabmoFetch`.
 *
 * A published package's export is what a plugin bundle was built against, so the
 * old names stay as aliases of the SAME implementation rather than a copy.
 */
export const useChamberFetch = useKabmoFetch;

/** @deprecated Use `KabmoFetchOptions`. */
export type ChamberFetchOptions = KabmoFetchOptions;

/** @deprecated Use `KabmoFetchState`. */
export type ChamberFetchState<T> = KabmoFetchState<T>;
