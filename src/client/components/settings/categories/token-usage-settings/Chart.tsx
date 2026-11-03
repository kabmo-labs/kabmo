import type { ChartMetric } from '@/shared/types';
import type { CadenceBucket } from '@/shared/lib/usage/breakdown';
import { costLabel, tokenLabel } from '@/shared/lib/usage/view';

/** Ink ramp, strongest first. Chroma stays reserved for the error state. */
const SERIES_FILL = [
  'var(--theme-ink)',
  'color-mix(in oklab, var(--theme-ink) 72%, transparent)',
  'color-mix(in oklab, var(--theme-ink) 54%, transparent)',
  'color-mix(in oklab, var(--theme-ink) 38%, transparent)',
  'color-mix(in oklab, var(--theme-ink) 26%, transparent)',
  'color-mix(in oklab, var(--theme-ink) 16%, transparent)',
] as const;

export interface ChartProvider {
  id: string;
  name: string;
}

interface UsageChartProps {
  buckets: CadenceBucket[];
  metric: ChartMetric;
  providers: ChartProvider[];
  /** Providers currently drawn; a legend click toggles one. */
  visible: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** `day`/`week`/`month` — the period's own bucket width, for the aria label. */
  granularity: string;
}

function valueOf(bucket: CadenceBucket, metric: ChartMetric, provider: string): number {
  const split = bucket.byProvider[provider];
  if (!split) return 0;
  return metric === 'cost' ? split.cost : split.tokens;
}

/**
 * Stacked area, one band per provider.
 *
 * The bands are the point: a single line of the total cannot show that two
 * accounts serving the same model id are 95% / 4% of the bill. Bars would need
 * the same vertical budget and read worse at 30+ buckets, so bands reuse the
 * existing axis layout.
 */
export function UsageChart({ buckets, metric, providers, visible, onToggle, granularity }: UsageChartProps) {
  const drawn = providers.filter((provider) => visible.has(provider.id));
  if (buckets.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-[11px] text-ink/40">
        No usage recorded in this period.
      </div>
    );
  }

  // Cumulative totals per bucket, in legend order, so a band's top edge is the
  // sum of every band below it.
  const cumulative: number[][] = [];
  let running = new Array(buckets.length).fill(0) as number[];
  for (const provider of drawn) {
    running = running.map((value, index) => value + valueOf(buckets[index], metric, provider.id));
    cumulative.push(running);
  }
  const max = Math.max(...running, 0);
  const span = max > 0 ? max : 1;
  const x = (index: number) => (buckets.length === 1 ? 0 : (index / (buckets.length - 1)) * 100);
  const y = (value: number) => 98 - (value / span) * 94;
  const format = (value: number) => (metric === 'cost' ? costLabel(value) : tokenLabel(value));

  /** A provider's total for the whole period — the only figure it has. */
  const providerTotal = (providerId: string): number =>
    buckets.reduce((sum, bucket) => sum + valueOf(bucket, metric, providerId), 0);

  const bandPath = (band: number): string => {
    const top = cumulative[band];
    const base = band === 0 ? (new Array(buckets.length).fill(0) as number[]) : cumulative[band - 1];
    const up = top.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(value).toFixed(2)}`);
    const down = [...base].reverse().map((value, index) => `L${x(buckets.length - 1 - index).toFixed(2)},${y(value).toFixed(2)}`);
    return `${up.join(' ')} ${down.join(' ')} Z`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-32">
        <div className="absolute inset-0 flex flex-col justify-between pb-4 pt-1">
          <div className="w-full border-t border-dashed border-ink/5" />
          <div className="w-full border-t border-dashed border-ink/5" />
          <div className="w-full border-t border-ink/15" />
        </div>
        <div className="absolute bottom-4 left-0 top-0 flex w-10 flex-col justify-between font-mono text-[9px] text-ink/40">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="absolute bottom-4 left-10 right-0 top-0">
          <svg
            className="h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
            role="img"
            aria-label={`${metric} by provider, bucketed by ${granularity}`}
          >
            {drawn.map((provider, band) => (
              <path
                key={provider.id}
                d={bandPath(band)}
                fill={SERIES_FILL[providers.indexOf(provider) % SERIES_FILL.length]}
                stroke="none"
              />
            ))}
          </svg>
        </div>
        <div className="absolute bottom-0 left-10 right-0 flex h-4 items-end justify-between text-[9px] text-ink/40">
          <span>{buckets[0]?.label}</span>
          {buckets.length > 2 && <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>}
          {/* One bucket would otherwise print the same label twice. */}
          {buckets.length > 1 && <span>{buckets[buckets.length - 1]?.label}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {providers.map((provider) => {
          const active = visible.has(provider.id);
          const figure = providerTotal(provider.id);
          return (
            <button
              key={provider.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(provider.id)}
              className={`flex items-center gap-1.5 text-[10px] transition-opacity ${
                active ? 'text-ink/70' : 'line-through text-ink/35'
              } hover:text-ink`}
              title={`${provider.name}: ${format(figure)} in this period`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: SERIES_FILL[providers.indexOf(provider) % SERIES_FILL.length] }}
              />
              <span className="font-medium">{provider.name}</span>
              <span className="font-mono tabular-nums text-ink/45">{format(figure)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
