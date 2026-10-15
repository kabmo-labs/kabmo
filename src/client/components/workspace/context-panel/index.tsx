import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import type { SessionContextTelemetry } from '@/shared/types';
import { emptyTelemetry } from '@/client/data/context-data';
import { ContextWindowCard } from '@/client/components/workspace/context-panel/WindowCard';
import { ContextStatsGrid } from '@/client/components/workspace/context-panel/StatsGrid';
import { LastMessageCard } from '@/client/components/workspace/context-panel/LastMessageCard';
import { TokenDistributionBar } from '@/client/components/workspace/context-panel/TokenDistributionBar';
import { RawMessagesList } from '@/client/components/workspace/context-panel/RawMessagesList';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { sessionTelemetryTopic } from '@/shared/lib/realtime/protocol';

interface ContextPanelProps {
  className?: string;
  enabled?: boolean;
  refreshKey?: number;
  onClose?: () => void;
}

export function ContextPanel({
  className = '',
  enabled = true,
  refreshKey = 0
}: ContextPanelProps) {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  const [telemetry, setTelemetry] = useState<SessionContextTelemetry>(() =>
    emptyTelemetry(sessionId || 'default', 'Session not started')
  );

  // Bound to the current session and live until unmount so the auto-refresh
  // interval below can re-read it without being torn down per render.
  const cancelledRef = useRef(false);
  const loadTelemetry = useCallback(() => {
    if (typeof window === 'undefined') return;
    const param = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    fetch(`/api/telemetry/context${param}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelledRef.current && data && data.telemetry) {
          setTelemetry(data.telemetry);
        }
      })
      .catch((err) => {
        if (!cancelledRef.current) {
          console.warn('Failed to fetch context telemetry:', err);
        }
      });
  }, [sessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled) return;
    loadTelemetry();
    return () => {
      cancelledRef.current = true;
    };
  }, [enabled, refreshKey, loadTelemetry]);

  // Telemetry rides the `session:<id>:telemetry` topic: the server pushes a
  // fresh snapshot when the turn's usage lands, so neither the poll nor the
  // file-mutation hook is needed. The HTTP read above stays as the fallback for
  // MOCK mode and for a session whose topic has no resolver.
  const topicTelemetry = useRealtimeTopic<SessionContextTelemetry>(
    sessionId ? sessionTelemetryTopic(sessionId) : null,
    { enabled },
  );
  // A new telemetry snapshot means the transcript grew past the last read —
  // the server republishes the topic when a tool result lands (and at the run
  // boundary) — so the paged raw-messages view below re-reads its page too.
  // The HTTP fallback path above still owns the summary state; this effect
  // only drives the raw list's refresh key.
  const [rawRefreshKey, setRawRefreshKey] = useState(0);
  useEffect(() => {
    if (topicTelemetry.data) {
      setTelemetry(topicTelemetry.data);
      setRawRefreshKey((k) => k + 1);
    }
  }, [topicTelemetry.data]);

  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  if (telemetry.messagesCount === 0) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono">Session not started</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-paper text-ink overflow-hidden select-none ${className}`}>
      {/* Top Header with a refresh affordance: the telemetry rides a topic a
          tool call republishes, and the button spins on that push so the user
          notices the numbers moved. */}
      <div className="flex-shrink-0 p-4 border-b border-ink/10 bg-paper">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-ink tracking-tight truncate">
              {telemetry.sessionTitle}
            </h2>
            <div className="text-[11px] text-ink/50 mt-1 truncate font-mono">
              {telemetry.timestamp}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { topicTelemetry.refresh(); loadTelemetry(); }}
            disabled={!enabled}
            title="Refresh context telemetry"
            aria-label="Refresh context telemetry"
            aria-busy={topicTelemetry.refreshing}
            className="flex-shrink-0 rounded-md border border-ink/15 bg-paper p-1.5 text-ink/80 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={topicTelemetry.refreshing ? 'animate-spin text-ink' : ''} />
          </button>
        </div>
      </div>

      {/* Scrollable Context Body */}
      <div className="flex-1 scrollbar-overlay-container p-4 space-y-4">
        {/* 1. Context Window Usage Progress Card */}
        <ContextWindowCard
          used={telemetry.contextUsed}
          limit={telemetry.contextLimit}
          percent={telemetry.contextPercent}
        />

        {/* 2. Metric Row (Messages, User, Assistant, Cache Hit, Cost + detail) */}
        <ContextStatsGrid
          messagesCount={telemetry.messagesCount}
          userCount={telemetry.userCount}
          assistantCount={telemetry.assistantCount}
          costFormatted={telemetry.costFormatted}
          cacheHitAverage={telemetry.cacheHitAverage}
          costBreakdown={telemetry.costBreakdown}
        />

        {/* 3. Last Assistant Message Stats */}
        <LastMessageCard
          input={telemetry.lastMessage.input}
          output={telemetry.lastMessage.output}
          reasoning={telemetry.lastMessage.reasoning}
          cacheRead={telemetry.lastMessage.cacheRead}
          cacheWrite={telemetry.lastMessage.cacheWrite}
          cacheHitPercent={telemetry.lastMessage.cacheHitPercent}
        />

        {/* 4. Token Distribution Segmented Bar */}
        <TokenDistributionBar
          userPercent={telemetry.distribution.userPercent}
          assistantPercent={telemetry.distribution.assistantPercent}
          toolPercent={telemetry.distribution.toolPercent}
          otherPercent={telemetry.distribution.otherPercent}
        />

        {/* 5. Raw Messages List (server-side paged) */}
        <RawMessagesList sessionId={sessionId} refreshKey={refreshKey + rawRefreshKey} />
      </div>
    </div>
  );
}
