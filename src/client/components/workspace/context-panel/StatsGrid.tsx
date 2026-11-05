import { useState } from 'preact/hooks';
import { Info } from 'lucide-preact';
import type { ContextCostBreakdown } from '@/shared/types';
import { CostBreakdownPopover } from '@/client/components/workspace/context-panel/CostBreakdownPopover';
import { StatCard } from '@/client/components/common/StatCard';

interface ContextStatsGridProps {
  messagesCount: number;
  userCount: number;
  assistantCount: number;
  costFormatted: string;
  cacheHitAverage?: number;
  costBreakdown?: ContextCostBreakdown;
}

export function ContextStatsGrid({
  messagesCount,
  userCount,
  assistantCount,
  costFormatted,
  cacheHitAverage,
  costBreakdown
}: ContextStatsGridProps) {
  const [costOpen, setCostOpen] = useState(false);

  return (
    <>
      <div className="mb-1.5">
        <span className="text-xs font-semibold text-ink/80">Session Stats</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <StatCard variant="compact" label="Messages" value={messagesCount} />
        <StatCard variant="compact" label="User" value={userCount} />
        <StatCard variant="compact" label="Assistant" value={assistantCount} />
        <StatCard
          variant="compact"
          label="Cache Hit"
          value={cacheHitAverage !== undefined ? `${cacheHitAverage.toFixed(1)}%` : '–'}
        />
        <div className="relative bg-canvas border border-ink/10 rounded-lg px-2.5 py-1.5 flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[10px] font-medium text-ink/50 flex items-center gap-1">
            Cost
            <button
              type="button"
              onClick={() => setCostOpen(true)}
              className="p-0.5 rounded text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
              aria-label="Show cost breakdown"
              title="Cost breakdown"
            >
              <Info size={11} />
            </button>
          </span>
          <span className="text-xs font-semibold font-mono text-ink truncate">{costFormatted}</span>
          <CostBreakdownPopover
            open={costOpen}
            onClose={() => setCostOpen(false)}
            breakdown={costBreakdown}
            costFormatted={costFormatted}
          />
        </div>
      </div>
    </>
  );
}
