/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Loads the Token Usage payload and keeps it fresh while the index catches up.
 *
 * Three behaviours the panel depends on:
 *
 *  - **One request per period.** Cadence and breakdown tab live in the
 *    component; changing them re-folds the payload client-side.
 *  - **Stale-while-revalidate.** A range change keeps the previous numbers on
 *    screen (`refreshing`) instead of blanking the panel, and the first load is
 *    the only case that shows a skeleton.
 *  - **Abort.** A fast user clicking ranges would otherwise render whichever
 *    response happened to arrive last.
 *
 * While `index.state` is `building` the hook polls: the indexer answers with
 * the data it already has, so the panel draws immediately and the footer says
 * "indexing…" until the next poll reports `ready`.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TimeRangeType, TokenUsagePayload } from '@/shared/types';

const POLL_MS = 1_500;

export interface TokenUsageState {
  payload: TokenUsagePayload | null;
  error: string | null;
  /** True only until the first payload arrives. */
  loading: boolean;
  /** A request is in flight while older data is on screen. */
  refreshing: boolean;
  reload: (force?: boolean) => void;
}

export function useTokenUsage(range: TimeRangeType, custom: { from: string; to: string }): TokenUsageState {
  const [payload, setPayload] = useState<TokenUsagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const payloadRef = useRef<TokenUsagePayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const request = useCallback(
    (): string => {
      const params = new URLSearchParams({ range });
      if (range === 'custom') {
        params.set('customFrom', custom.from);
        params.set('customTo', custom.to);
      }
      return `/api/telemetry/tokens?${params.toString()}${forceRef.current ? '&refresh=1' : ''}`;
    },
    [range, custom.from, custom.to],
  );

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      forceRef.current = force;
      setRefreshing(true);
      try {
        const response = await fetch(request(), {
          signal: controller.signal,
          method: force ? 'POST' : 'GET',
        });
        const body = (await response.json()) as TokenUsagePayload & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? `Token usage failed (${response.status})`);
        payloadRef.current = body;
        setPayload(body);
        setError(null);
        setLoading(false);
        clearTimer();
        if (body.index.state === 'building') {
          timerRef.current = setTimeout(() => {
            forceRef.current = false;
            void load(false);
          }, POLL_MS);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load token usage');
        setLoading(false);
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    },
    [request],
  );

  useEffect(() => {
    // Only the FIRST load has nothing to show. A range change keeps the
    // previous numbers on screen with an "updating…" hint instead of blanking
    // the panel the user is reading.
    setLoading((current) => current && payloadRef.current === null);
    void load(false);
    return () => {
      abortRef.current?.abort();
      clearTimer();
    };
  }, [load]);

  const reload = useCallback(
    (force = false) => {
      clearTimer();
      void load(force);
    },
    [load],
  );

  return { payload, error, loading, refreshing, reload };
}
