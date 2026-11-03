import { useMemo, useState } from 'preact/hooks';
import type {
  BreakdownTab,
  BucketGranularity,
  ChartMetric,
  SettingsState,
  TimeRangeType,
  UsageTotals,
} from '@/shared/types';
import { TokenUsageControls } from '@/client/components/settings/categories/token-usage-settings/Controls';
import { TokenUsageMetricsGrid } from '@/client/components/settings/categories/token-usage-settings/MetricsGrid';
import { UsageChart } from '@/client/components/settings/categories/token-usage-settings/Chart';
import { TokenUsageBreakdown } from '@/client/components/settings/categories/token-usage-settings/Breakdown';
import { UsageProvenance } from '@/client/components/settings/categories/token-usage-settings/Provenance';
import { useTokenUsage } from '@/client/hooks/settings/useTokenUsage';
import { breakdownRows, bucketDays } from '@/shared/lib/usage/breakdown';
import { cacheHitLabel, costLabel, tokenLabel } from '@/shared/lib/usage/view';
import { dayWindow, granularityFor, localDayKey, spanOfDays } from '@/shared/lib/usage/range';

interface TokenUsageSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const CHART_METRICS: Array<{ id: ChartMetric; label: string }> = [
  { id: 'cost', label: 'COST' },
  { id: 'tokens', label: 'TOKENS' },
];

/** What each period option is called in prose, for the cost card's caption. */
const PERIOD_NAME: Record<TimeRangeType, string> = {
  today: 'Day',
  '7d': 'Week',
  '30d': 'Month',
  '90d': '90 days',
  all: 'All time',
  custom: 'Custom',
};

/**
 * Settings → Token Usage.
 *
 * ONE period control. Day, Week, Month, 90 days, All time and Custom are the
 * same kind of choice — which trailing span to report — so there is no separate
 * daily/weekly/monthly switch, and every figure on the panel is that span's
 * total. The only thing derived from the period is how the chart and the time
 * tab bucket it (`granularityFor`): a day or a month draws days, a quarter
 * draws weeks, all time draws months.
 */
export function TokenUsageSettings({ settings: _settings, onUpdate: _onUpdate }: TokenUsageSettingsProps) {
  const [range, setRange] = useState<TimeRangeType>('30d');
  const [tab, setTab] = useState<BreakdownTab>('model');
  const [metric, setMetric] = useState<ChartMetric>('cost');
  const [today] = useState(() => localDayKey(Date.now()));
  const [customFrom, setCustomFrom] = useState(() => localDayKey(Date.now() - 29 * 24 * 60 * 60 * 1000));
  const [customTo, setCustomTo] = useState(today);
  // Providers hidden from the chart, by slug.
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(new Set());

  const { payload, error, loading, refreshing, reload } = useTokenUsage(range, { from: customFrom, to: customTo });

  const providers = payload?.providers ?? [];
  const totals: UsageTotals = payload?.totals ?? ZERO_TOTALS;
  const granularity: BucketGranularity = granularityFor(range, { from: customFrom, to: customTo });
  // The period's own days, INCLUDING the ones the rollup never saw: the table
  // lists the period, not just the days that happened to carry usage. All time
  // has no bounded window, so its span comes from the recorded days themselves.
  const window = useMemo(
    () =>
      dayWindow(range, payload?.generatedAt ?? Date.now(), { from: customFrom, to: customTo }) ??
      spanOfDays((payload?.days ?? []).map((row) => row.day)),
    [range, payload?.generatedAt, payload?.days, customFrom, customTo],
  );
  const buckets = useMemo(() => bucketDays(payload?.days ?? [], granularity), [payload?.days, granularity]);
  const rows = useMemo(
    () =>
      payload
        ? breakdownRows(
            tab,
            { totals, providers: payload.providers, days: payload.days, projects: payload.projects },
            granularity,
            window,
          )
        : [],
    [tab, payload, totals, granularity, window],
  );
  const providerNames = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const visibleProviders = useMemo(
    () => new Set(providers.filter((provider) => !hiddenProviders.has(provider.id)).map((provider) => provider.id)),
    [providers, hiddenProviders],
  );

  if (error && !payload) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <p className="text-xs font-semibold text-ink">Token usage could not be read</p>
        <p className="text-[11px] text-ink/60">{error}</p>
        <button
          type="button"
          onClick={() => reload(true)}
          className="rounded-md border border-ink/15 bg-paper px-3 py-1 text-[11px] font-medium text-ink hover:bg-ink/5"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading || !payload) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-8 w-full animate-pulse rounded-md bg-ink/5" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div className="h-28 animate-pulse rounded-lg bg-ink/5 xl:col-span-2" />
          <div className="h-28 animate-pulse rounded-lg bg-ink/5" />
        </div>
        <div className="h-52 animate-pulse rounded-lg bg-ink/5" />
        <p className="text-center text-[10px] text-ink/40">Indexing session transcripts…</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 pb-2 text-xs text-ink">
      <TokenUsageControls
        range={range}
        onRange={setRange}
        ranges={payload.timeRanges}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        periodLabel={payload.periodLabel}
        generatedAt={payload.generatedAt}
        refreshing={refreshing}
        onRefresh={() => reload(true)}
      />

      {error && (
        // A failed refresh keeps the last good numbers on screen — but it says
        // so, because a stale figure presented as current is a wrong figure.
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--theme-error)]/40 bg-[var(--theme-error)]/5 px-3 py-1.5 text-[11px]"
        >
          <span className="text-ink/75">Showing the last successful read. {error}</span>
          <button
            type="button"
            onClick={() => reload(true)}
            className="rounded border border-ink/15 bg-paper px-2 py-0.5 font-medium text-ink hover:bg-ink/5"
          >
            Retry
          </button>
        </div>
      )}

      <TokenUsageMetricsGrid totals={totals} periodName={PERIOD_NAME[range]} />

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 shadow-xs">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold capitalize text-ink">{metric} by provider</span>
            <span className="text-[10px] text-ink/45">
              {buckets.length} {granularity} {buckets.length === 1 ? 'bucket' : 'buckets'} · click a legend entry to hide
              it
            </span>
          </div>
          <div role="tablist" aria-label="Chart metric" className="flex rounded bg-ink/5 p-0.5">
            {CHART_METRICS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={metric === entry.id}
                onClick={() => setMetric(entry.id)}
                className={`rounded px-2 py-0.5 text-[9px] font-bold tracking-wider transition-colors ${
                  metric === entry.id ? 'bg-paper text-ink shadow-xs' : 'text-ink/50 hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <UsageChart
          buckets={buckets}
          metric={metric}
          granularity={granularity}
          providers={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
          visible={visibleProviders}
          onToggle={(id) =>
            setHiddenProviders((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      </div>

      <TokenUsageBreakdown
        tab={tab}
        onTab={setTab}
        rows={rows}
        totals={totals}
        granularity={granularity}
        providerNames={providerNames}
      />

      <UsageProvenance index={payload.index} generatedAt={payload.generatedAt} providers={providers.length} />

      <details className="rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 text-[10px] text-ink/50">
        <summary className="cursor-pointer select-none font-semibold text-ink/60">How these numbers are produced</summary>
        <ul className="mt-2 space-y-1 leading-relaxed">
          <li>
            Cost and tokens are omp's own per-message records, attributed to the provider and model that served the
            turn. A turn without a reported rate is counted as unpriced, never as free.
          </li>
          <li>
            Cache hit rate is cache reads over all observed input. “Paid for cache reads” is what those reads cost, not
            what they saved.
          </li>
          <li>
            Each transcript is read once; later requests re-read only the bytes appended since. Clearing Kabmo's
            database rebuilds the index from the session files.
          </li>
          <li>
            {totals.records.toLocaleString('en-US')} turns in this period · {tokenLabel(totals.tokens)} tokens ·{' '}
            {cacheHitLabel(totals)} cached · {costLabel(totals.cost)} at API rates · {providers.length}{' '}
            {providers.length === 1 ? 'provider' : 'providers'}
          </li>
        </ul>
      </details>
    </div>
  );
}

const ZERO_TOTALS: UsageTotals = {
  cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
  cacheReadCost: 0, records: 0, unpriced: 0, activeDays: 0,
};
