import type { UsageTotals } from '@/shared/types';
import { StatCard } from '@/client/components/common/StatCard';
import { cacheHitLabel, costLabel, costPerMillionLabel, toMetricSet } from '@/shared/lib/usage/view';

interface TokenUsageMetricsGridProps {
  totals: UsageTotals;
  /** Human period label (`Day`, `Week`, `Month`, …) for the cost caption. */
  periodName: string;
}

/**
 * The headline numbers for the selected period.
 *
 * Plain totals — the panel reports one span, so there is nothing to average and
 * nothing that changes with a grouping choice. `periodName` only names the span
 * the totals belong to.
 */
export function TokenUsageMetricsGrid({ totals, periodName }: TokenUsageMetricsGridProps) {
  const metrics = toMetricSet(totals);
  const hitRate = totals.cacheRead + totals.input > 0 ? totals.cacheRead / (totals.cacheRead + totals.input) : 0;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <div className="flex flex-col justify-between rounded-lg border border-ink/15 bg-paper p-3.5 shadow-xs">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              Provider-reported cost
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink/30">{periodName}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight tabular-nums text-ink">{metrics.rawCost}</span>
            <span className="text-[11px] text-ink/45">at API rates</span>
          </div>
          <p className="mt-1 text-[11px] text-ink/50">
            {costPerMillionLabel(totals)} per 1M tokens · {metrics.processedTokens} tokens ·{' '}
            {totals.records.toLocaleString('en-US')} turns
          </p>
        </div>

        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-ink/80" style={{ width: `${Math.min(100, hitRate * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink/60">
            <span>{cacheHitLabel(totals)} served from cache</span>
            <span className="tabular-nums text-ink/80">{metrics.cachedInput} cached</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 xl:col-span-2">
        <StatCard value={metrics.processedTokens} label="Processed tokens" hint={metrics.activeRate} />
        <StatCard value={metrics.outputTokens} label="Output" hint={metrics.reasoning} />
        <StatCard value={metrics.uncachedInput} label="Uncached input" hint={`${metrics.cacheWrite} cache writes`} />
        <StatCard
          value={costLabel(totals.cacheReadCost)}
          label="Paid for cache reads"
          hint={`${metrics.cachedInput} read at the cache rate`}
          tone="muted"
        />
      </div>
    </div>
  );
}
