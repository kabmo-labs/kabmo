import type { UsageHarnessRow } from '@/shared/types';
import { costLabel } from '@/shared/lib/usage/view';

interface TokenUsageHarnessFilterProps {
  harnesses: UsageHarnessRow[];
  selected: string;
  onSelect: (harness: string) => void;
}

/**
 * The harness chips.
 *
 * A chip row rather than another dropdown: the choice is a short list of the
 * agents that actually recorded usage, and the counts are the context needed to
 * choose one — a menu would hide them behind a click on every period change.
 *
 * Only harnesses the index READ are listed (the payload says so), because a
 * filter entry that can only ever empty the panel is worse than no entry.
 */
export function TokenUsageHarnessFilter({ harnesses, selected, onSelect }: TokenUsageHarnessFilterProps) {
  if (harnesses.length === 0) return null;
  const total = harnesses.reduce(
    (acc, row) => {
      acc.records += row.records;
      acc.cost += row.cost;
      return acc;
    },
    { records: 0, cost: 0 },
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink/40">
        Harness
      </span>
      <div role="group" aria-label="Filter by harness" className="flex min-w-0 gap-1 overflow-x-auto pb-0.5">
        {[{ id: 'all', name: 'All', records: total.records, cost: total.cost }, ...harnesses].map((row) => (
          <button
            key={row.id}
            type="button"
            aria-pressed={selected === row.id}
            onClick={() => onSelect(row.id)}
            title={`${row.name} · ${costLabel(row.cost)}`}
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              selected === row.id
                ? 'border-ink/70 bg-ink text-paper'
                : 'border-ink/10 bg-ink/5 text-ink/65 hover:bg-ink/10'
            }`}
          >
            {row.name}{' '}
            <span className={`ml-1 tabular-nums ${selected === row.id ? 'text-paper/70' : 'text-ink/35'}`}>
              {row.records.toLocaleString('en-US')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
