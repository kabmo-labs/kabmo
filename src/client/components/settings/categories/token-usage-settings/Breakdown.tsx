import { useMemo, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight } from 'lucide-preact';
import type { BreakdownTab, BucketGranularity, UsageTotals } from '@/shared/types';
import type { BreakdownViewRow } from '@/shared/lib/usage/breakdown';
import { cacheHitLabel, costLabel, costPerMillionLabel, tokenLabel } from '@/shared/lib/usage/view';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

/**
 * The time tab is named for the bucket width the PERIOD implies. A month of
 * usage is a list of days; a quarter is a list of weeks; all time is months.
 */
function tabsFor(granularity: BucketGranularity): Array<{ id: BreakdownTab; label: string }> {
  return [
    { id: 'provider', label: 'PROVIDER' },
    { id: 'model', label: 'MODEL' },
    { id: 'day', label: granularity === 'week' ? 'WEEK' : granularity === 'month' ? 'MONTH' : 'DAY' },
    { id: 'project', label: 'PROJECT' },
  ];
}

/** Provider rows shown before "Show all" — twelve was the old silent ceiling. */
const COLLAPSED_ROWS = 8;
/**
 * Time rows shown at once. A period is fully enumerated (every day of the
 * month), so this is a scroll region, not a truncation: the table body scrolls
 * and the count above it says how many rows the period has.
 */
const TIME_ROWS_VISIBLE = 14;

interface TokenUsageBreakdownProps {
  tab: BreakdownTab;
  onTab: (tab: BreakdownTab) => void;
  rows: BreakdownViewRow[];
  totals: UsageTotals;
  granularity: BucketGranularity;
  /** Provider slugs to display names, for the icon plate. */
  providerNames: Record<string, string>;
}

/**
 * The provider → model tree, the time table and the project table.
 *
 * The Model tab is deliberately two-level: `message.provider` was on every usage
 * record, but the breakdown keyed on model alone, so two accounts serving
 * `deepseek-v4-1-flash` showed up as one $1 673.86 row instead of $1 619.43 and
 * $54.43 — the one number a multi-account user needs to see.
 *
 * Every cell is the selected PERIOD's total — there is no per-day/per-week
 * number, because a period is a single span. Only the time tab's bucket width
 * varies, and it follows the period's length (see `tabsFor`).
 */
export function TokenUsageBreakdown({
  tab,
  onTab,
  rows,
  totals,
  granularity,
  providerNames,
}: TokenUsageBreakdownProps) {
  // `null` means "the default": the top three providers open, the rest closed
  // so the rows carrying the answer need no click. The first explicit toggle
  // materialises a concrete set, and from then on the user's choice wins —
  // including collapsing one of those three (a chevron that cannot close its
  // own row is worse than no chevron).
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [showAll, setShowAll] = useState(false);

  const isTree = tab === 'provider' || tab === 'model';
  const defaultOpen = useMemo(
    () => new Set(rows.filter((row) => row.kind === 'group').slice(0, 3).map((row) => row.provider ?? '')),
    [rows],
  );
  const openSet = expanded ?? defaultOpen;

  // A time tab lists the PERIOD, so it is never sliced: the body scrolls
  // instead. Slicing it to eight rows is what made a month look like it had
  // only eight days.
  const visibleRows = useMemo(() => {
    if (!isTree) return rows;
    const shown: BreakdownViewRow[] = [];
    for (const row of rows) {
      if (row.kind === 'group' || showAll || openSet.has(row.provider ?? '')) shown.push(row);
    }
    return shown;
  }, [rows, isTree, showAll, openSet]);

  const toggle = (provider: string) => {
    const next = new Set(openSet);
    if (next.has(provider)) next.delete(provider);
    else next.add(provider);
    setExpanded(next);
  };

  const firstColumn = tab === 'day' ? granularity : tab === 'model' ? 'Provider / Model' : tab;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 shadow-xs xl:col-span-2">
        {/* Wraps rather than overflowing: at phone widths the four tabs were
            14–84 px wider than the card, so PROJECT sat outside it and looked
            like a missing tab. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <span className="flex items-baseline gap-2 text-xs font-semibold text-ink">
            Breakdown
            <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-ink/35">
              {isTree ? 'period total' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · ${granularity}`}
            </span>
          </span>
          <div role="tablist" aria-label="Breakdown" className="flex shrink-0 rounded bg-ink/5 p-0.5">
            {tabsFor(granularity).map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => onTab(entry.id)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
                  tab === entry.id ? 'bg-paper text-ink shadow-xs' : 'text-ink/50 hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink/40">No usage recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <div
              // A time tab's rows scroll; the provider tree is short enough to
              // render whole and must not nest two scroll regions.
              className={isTree ? undefined : 'overflow-y-auto'}
              style={isTree ? undefined : { maxHeight: `${TIME_ROWS_VISIBLE * 1.6}rem` }}
            >
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-ink/10 text-ink/40">
                  <th className="pb-2 text-left font-medium capitalize">{firstColumn}</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                  <th className="pb-2 text-right font-medium">Share</th>
                  <th className="pb-2 text-right font-medium">Tokens</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Cache</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Turns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {visibleRows.map((row) => {
                  const isGroup = row.kind === 'group';
                  const providerId = row.provider ?? '';
                  const open = !isGroup || showAll || openSet.has(providerId);
                  return (
                    <tr key={row.key} className={isGroup ? 'bg-ink/[0.02]' : undefined}>
                      <td className="py-2">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${row.depth * 14}px` }}>
                          {isGroup ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${row.label} models`}
                              onClick={() => toggle(providerId)}
                              className="-ml-0.5 text-ink/50 transition-colors hover:text-ink"
                            >
                              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          ) : null}
                          {row.provider && (
                            <ProviderIconPlate
                              provider={{
                                slug: row.provider,
                                name: providerNames[row.provider] ?? row.provider,
                              }}
                              size={isGroup ? 16 : 14}
                              radius={4}
                            />
                          )}
                          <span
                            className={`whitespace-nowrap ${
                              isGroup ? 'font-semibold text-ink' : 'font-medium text-ink/85'
                            }`}
                          >
                            {row.label}
                          </span>
                        </div>
                      </td>
                      <td className={`py-2 text-right tabular-nums ${isGroup ? 'font-bold text-ink' : 'text-ink/80'}`}>
                        {costLabel(row.cost)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink/60">{row.sharePercent.toFixed(1)}%</td>
                      <td className="py-2 text-right tabular-nums text-ink/60">{tokenLabel(row.tokens)}</td>
                      <td className="hidden py-2 text-right tabular-nums text-ink/60 sm:table-cell">{row.cacheHit}</td>
                      <td className="hidden py-2 text-right tabular-nums text-ink/60 sm:table-cell">
                        {row.records.toLocaleString('en-US')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-ink/5">
          {rows
            .filter((row) => row.kind === 'group' || !isTree)
            .slice(0, COLLAPSED_ROWS)
            .map((row, index) => (
              <div
                key={row.key}
                className={index === 0 ? 'bg-ink/80' : index === 1 ? 'border-l border-paper bg-ink/45' : 'border-l border-paper bg-ink/25'}
                style={{ width: `${row.sharePercent}%` }}
              />
            ))}
        </div>

        {isTree && !showAll && visibleRows.length < rows.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-2 text-[10px] font-semibold text-ink/50 transition-colors hover:text-ink"
          >
            Show all {rows.length} rows
          </button>
        )}
      </div>

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 shadow-xs">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-ink">Cost quality</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink/35">period total</span>
        </div>
        <dl className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <dt className="text-ink/60">Cost per 1M tokens</dt>
            <dd className="tabular-nums font-semibold text-ink">{costPerMillionLabel(totals)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink/60">Cache hit rate</dt>
            <dd className="tabular-nums font-semibold text-ink">{cacheHitLabel(totals)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink/60">Unpriced turns</dt>
            <dd className="tabular-nums font-semibold text-ink">
              {totals.records > 0 ? `${((totals.unpriced / totals.records) * 100).toFixed(1)}%` : '–'}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink/60">Turns</dt>
            <dd className="tabular-nums font-semibold text-ink">{totals.records.toLocaleString('en-US')}</dd>
          </div>
        </dl>

        <div className="mt-3 border-t border-ink/10 pt-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ink/60">Paid for cache reads</span>
            <span className="tabular-nums font-semibold text-ink">{costLabel(totals.cacheReadCost)}</span>
          </div>
          <p className="mt-1 text-[10px] leading-tight text-ink/40">
            Provider-reported cost only. A turn with no reported rate counts as unpriced rather than free.
          </p>
        </div>
      </div>
    </div>
  );
}
