import { useState } from 'preact/hooks';
import { CalendarRange, RefreshCw } from 'lucide-preact';
import { localDayKey } from '@/shared/lib/usage/range';
import type { TimeRangeOption, TimeRangeType } from '@/shared/types';

interface TokenUsageControlsProps {
  range: TimeRangeType;
  onRange: (range: TimeRangeType) => void;
  ranges: TimeRangeOption[];
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  periodLabel: string;
  /** Epoch ms the payload was generated; the custom window is relative to it. */
  generatedAt: number;
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * The panel's control bar: the PERIOD, and refresh.
 *
 * Day / Week / Month / 90 days / All time / Custom are one list — they are all
 * the same kind of choice (which trailing span to report), so the panel has a
 * single control and no separate daily/weekly/monthly switch. Every figure in
 * the panel is the total for the span selected here.
 */
export function TokenUsageControls({
  range,
  onRange,
  ranges,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
  periodLabel,
  generatedAt,
  refreshing,
  onRefresh,
}: TokenUsageControlsProps) {
  const [open, setOpen] = useState(false);
  // "Today" is the day the PAYLOAD was built on, so the picker's ceiling cannot
  // drift from the dates the panel is showing (a tab left open across midnight).
  const ceiling = localDayKey(generatedAt);

  return (
    <div className="flex flex-col gap-2 border-b border-ink/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="truncate text-xs font-semibold text-ink/75">{periodLabel}</span>
        {refreshing && <span className="text-[10px] text-ink/40">updating…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1.5 rounded-md border border-ink/15 bg-paper px-2.5 py-1 text-[11px] font-medium text-ink/80 transition-colors hover:bg-ink/5"
          >
            <CalendarRange size={12} aria-hidden="true" />
            {/* A custom window names its dates: a bare "Custom…" is
                indistinguishable from a range that did nothing when its dates
                happen to equal the previous preset. */}
            <span>
              {range === 'custom'
                ? `${customFrom} – ${customTo}`
                : (ranges.find((entry) => entry.id === range)?.label ?? 'Month')}
            </span>
          </button>

          {open && (
            // Anchored LEFT on phones: the trigger fills the row there, and a
            // `right-0` menu hung off its right edge landed at x=-157. From
            // `sm` up the trigger is narrow and right-aligned, so the menu
            // follows it.
            <div className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] divide-y divide-ink/5 rounded-md border border-ink/15 bg-paper py-1 text-[11px] shadow-lg sm:left-auto sm:right-0">
              {ranges.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={range === entry.id ? 'true' : undefined}
                  onClick={() => {
                    onRange(entry.id);
                    if (entry.id !== 'custom') setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/5 ${
                    range === entry.id ? 'bg-ink/5 font-semibold text-ink' : 'text-ink/70'
                  }`}
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="shrink-0 text-[10px] text-ink/40">{entry.dateRange}</span>
                </button>
              ))}

              {range === 'custom' && (
                <div className="space-y-2 px-3 py-2">
                  {(
                    [
                      { label: 'From', value: customFrom, set: onCustomFrom, min: undefined, max: customTo },
                      { label: 'To', value: customTo, set: onCustomTo, min: customFrom, max: ceiling },
                    ] as const
                  ).map((field) => (
                    <label key={field.label} className="block">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-ink/40">{field.label}</span>
                      <input
                        type="date"
                        value={field.value}
                        min={field.min}
                        max={field.max}
                        onChange={(event) => field.set(event.currentTarget.value)}
                        className="mt-0.5 w-full rounded border border-ink/15 bg-paper px-1.5 py-1 text-[11px] text-ink focus:border-ink/40 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          title="Refresh token usage"
          aria-label="Refresh token usage"
          className="rounded-md border border-ink/15 bg-paper p-1.5 text-ink/80 transition-colors hover:bg-ink/5"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
