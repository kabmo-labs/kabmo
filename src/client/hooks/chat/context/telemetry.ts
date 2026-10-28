/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The active session's context telemetry, as the navbar indicator reads it.
 *
 * Two sources, in that order, because they cover different installs:
 *
 *   - the `session:<id>:telemetry` topic, which the server republishes when a
 *     tool call lands and at the run boundary — the same source the Context
 *     panel reads, so the ring moves while a turn streams;
 *   - the HTTP route, which is the only source in MOCK mode (the topic's
 *     resolver answers `null` there) and for a session held in memory rather
 *     than on disk.
 *
 * Subscribing from the navbar means the topic is resolved for every tool call
 * even when no Context panel is open. That cost is bounded by machinery that
 * already exists: the server coalesces a burst into one publish per 120 ms,
 * dedupes an unchanged payload, and the JSONL parse behind it is cached by
 * (size, mtime). A live ring is the whole point of the control, so a poll would
 * be the more expensive choice.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SessionContextTelemetry } from '@/shared/types/context';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { sessionTelemetryTopic } from '@/shared/lib/realtime/protocol';
import { clampContextPercent } from '@/shared/lib/chat/context/usage';

export interface SessionContextTelemetryState {
  telemetry: SessionContextTelemetry | null;
  /** The share of the window in use, clamped to `0..100`. */
  percent: number;
}

export function useSessionContextTelemetry(sessionId: string | null): SessionContextTelemetryState {
  const topic = useRealtimeTopic<SessionContextTelemetry>(
    sessionId ? sessionTelemetryTopic(sessionId) : null,
  );

  // The HTTP answer is a FALLBACK, not a second opinion: it is dropped the
  // moment the session changes so a previous session's numbers cannot be drawn
  // under the new title while the read is in flight.
  const [fallback, setFallback] = useState<SessionContextTelemetry | null>(null);
  useEffect(() => {
    setFallback(null);
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/telemetry/context?sessionId=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { telemetry?: SessionContextTelemetry } | null) => {
        if (!cancelled) setFallback(data?.telemetry ?? null);
      })
      .catch(() => {
        if (!cancelled) setFallback(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const telemetry = topic.data ?? fallback;
  return { telemetry, percent: clampContextPercent(telemetry?.contextPercent ?? 0) };
}
