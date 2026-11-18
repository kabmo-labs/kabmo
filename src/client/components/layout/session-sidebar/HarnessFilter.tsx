/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's harness filter: which agent ran the chat.
 *
 * A DROPDOWN, not a chip row. The list can hold a dozen harnesses (the built-in
 * catalog alone is seventeen), and a chip per harness measured three wrapped
 * lines at the 280px default — chrome that pushed the rows down and still hid
 * the tail. One trigger whose contents grow is the shape that survives the next
 * agent, the same reason the session row's actions live behind `⋯`.
 *
 * The options are counted over the unfiltered list (`harnessFilterOptions`), so
 * a number is a fact about the workspaces rather than about what the current
 * filter shows.
 *
 * **The control is hidden while the list holds one harness and no filter is
 * active.** A filter with one choice can only be wrong, and most users run one
 * agent — it appears the moment a second agent has a row, which is the moment
 * the question exists.
 *
 * **An active filter whose harness has no rows left is still offered**, with a
 * count of 0. Dropping it would leave the list empty with nothing on screen
 * explaining why, and no way back to `All` except a reload.
 *
 * The menu is `AnchoredMenu` (portalled, measured) because the sidebar is a
 * scroller: an `absolute` panel would be clipped at its edge and drift with the
 * rows.
 */

import { useState } from 'preact/hooks';
import { Check, ChevronDown } from 'lucide-preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { harnessBadgeLabel } from '@/shared/lib/harness/catalog';
import { anchorRectOf, type AnchorRect } from '@/shared/lib/ui/menu-anchor';
import type { HarnessFilterOption } from '@/shared/lib/workspace/harness-filter';

interface HarnessFilterProps {
  /** The harnesses the list holds, with row counts. */
  options: HarnessFilterOption[];
  /** The active harness, or null for every harness. */
  value: string | null;
  onChange: (harness: string | null) => void;
  /** Phone drawer: taller targets. */
  touch?: boolean;
}

const TRIGGER_BASE = 'inline-flex max-w-full items-center gap-1 rounded-full border font-medium transition-colors cursor-pointer';
const TRIGGER_ON = 'border-ink bg-ink text-paper';
const TRIGGER_OFF = 'border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink';
const ROW_BASE = 'w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-ink/5 cursor-pointer';
const ROW_ON = 'bg-ink/10 font-semibold text-ink';
const ROW_OFF = 'text-ink/75';

export function HarnessFilter({ options, value, onChange, touch = false }: HarnessFilterProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  // The active harness may have lost its last row since the click. It keeps a
  // row so the filter that emptied the list is visible and clearable.
  const shown = value && !options.some((option) => option.harness === value)
    ? [{ harness: value, label: harnessBadgeLabel(value), count: 0 }, ...options]
    : options;
  if (shown.length < 2 && !value) return null;

  const active = value ? shown.find((option) => option.harness === value) : undefined;
  const size = touch ? 'px-2 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';

  return (
    <div className="px-3 pt-2 pb-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Filter by harness"
        onClick={(event) => setAnchor(anchor ? null : anchorRectOf(event.currentTarget))}
        className={`${TRIGGER_BASE} ${size} ${value ? TRIGGER_ON : TRIGGER_OFF}`}
      >
        {active ? (
          <HarnessGlyph
            harness={active.harness}
            size={HARNESS_GLYPH_SIZE.compact}
            inherit
            decorative
          />
        ) : null}
        <span className="max-w-[9rem] truncate">{active ? active.label : 'All harnesses'}</span>
        {active ? <span className="font-mono tabular-nums opacity-70">{active.count}</span> : null}
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </button>

      <AnchoredMenu
        anchor={anchor}
        align="start"
        ariaLabel="Filter by harness"
        className="w-56 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 text-xs"
        onClose={() => setAnchor(null)}
      >
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setAnchor(null);
          }}
          className={`${ROW_BASE} ${!value ? ROW_ON : ROW_OFF}`}
        >
          <span className="flex-1 truncate">All harnesses</span>
          {!value ? <Check size={12} /> : null}
        </button>
        {shown.map((option) => {
          const on = option.harness === value;
          return (
            <button
              key={option.harness}
              type="button"
              onClick={() => {
                onChange(option.harness);
                setAnchor(null);
              }}
              className={`${ROW_BASE} ${on ? ROW_ON : ROW_OFF}`}
            >
              <HarnessGlyph harness={option.harness} size={HARNESS_GLYPH_SIZE.compact} decorative />
              <span className="flex-1 truncate">{option.label}</span>
              <span className="font-mono tabular-nums text-ink/50">{option.count}</span>
              {on ? <Check size={12} /> : null}
            </button>
          );
        })}
      </AnchoredMenu>
    </div>
  );
}
