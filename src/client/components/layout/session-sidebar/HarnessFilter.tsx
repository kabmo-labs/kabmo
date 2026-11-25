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
 * It sits immediately right of `Archived` in the `modern` filter row, and takes
 * two forms chosen by that row's measured width (`filterRowForms`): the full
 * chip, and the harness's own mark in the row's 22px slot. The classic chromes
 * still draw it as a standalone line under the toolbar.
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

import { useMemo, useState } from 'preact/hooks';
import { Bot, Check, ChevronDown } from 'lucide-preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { PickerSearch } from '@/client/components/common/picker-search';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';
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
  /** The narrow form for the filter row; the classic chrome draws the chip. */
  form?: 'chip' | 'icon';
  /** The classic chrome's standalone row: taller targets. */
  touch?: boolean;
}

const TRIGGER_BASE = 'inline-flex max-w-full shrink-0 items-center border font-medium transition-colors cursor-pointer';
const TRIGGER_ON = 'border-ink bg-ink text-paper';
const TRIGGER_OFF = 'border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink';
const ROW_BASE = 'w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-ink/5 cursor-pointer';
const ROW_ON = 'bg-ink/10 font-semibold text-ink';
const ROW_OFF = 'text-ink/75';

export function HarnessFilter({
  options,
  value,
  onChange,
  form = 'chip',
  touch = false,
}: HarnessFilterProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [query, setQuery] = useState('');

  // The active harness may have lost its last row since the click. It keeps a
  // row so the filter that emptied the list is visible and clearable.
  const shown = value && !options.some((option) => option.harness === value)
    ? [{ harness: value, label: harnessBadgeLabel(value), count: 0 }, ...options]
    : options;
  if (shown.length < 2 && !value) return null;

  const active = value && shown.find((option) => option.harness === value);
  const label = active ? active.label : 'All harnesses';

  // The catalog alone is seventeen harnesses before a user adds one, so the
  // list is searched like every other catalog rather than scrolled.
  const visible = useMemo(
    () => shown.filter((option) => matchesPickerQuery(`${option.label} ${option.harness}`, query)),
    [shown, query],
  );

  const close = () => {
    setAnchor(null);
    setQuery('');
  };

  const trigger = form === 'icon' ? (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={anchor !== null}
      aria-label={`Filter by harness: ${label}`}
      title={value ? `Harness: ${label}` : 'Filter by harness'}
      onClick={(event) => setAnchor(anchor ? null : anchorRectOf(event.currentTarget))}
      className={`${TRIGGER_BASE} h-[22px] w-[22px] justify-center rounded-md ${
        value ? 'border-ink bg-ink text-paper' : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink'
      }`}
    >
      {active ? (
        <HarnessGlyph
          harness={active.harness}
          size={HARNESS_GLYPH_SIZE.compact}
          inherit
          decorative
        />
      ) : (
        <Bot size={13} />
      )}
    </button>
  ) : (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={anchor !== null}
      title="Filter by harness"
      onClick={(event) => setAnchor(anchor ? null : anchorRectOf(event.currentTarget))}
      className={`${TRIGGER_BASE} gap-1 rounded-full ${touch ? 'px-2 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'} ${
        value ? TRIGGER_ON : TRIGGER_OFF
      }`}
    >
      {active ? (
        <HarnessGlyph
          harness={active.harness}
          size={HARNESS_GLYPH_SIZE.compact}
          inherit
          decorative
        />
      ) : null}
      <span className="max-w-[9rem] truncate">{label}</span>
      {active ? <span className="font-mono tabular-nums opacity-70">{active.count}</span> : null}
      <ChevronDown size={11} className="shrink-0 opacity-60" />
    </button>
  );

  return (
    <>
      {trigger}

      <AnchoredMenu
        anchor={anchor}
        align="start"
        ariaLabel="Filter by harness"
        className="w-56 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 text-xs"
        onClose={close}
      >
        <PickerSearch value={query} onChange={setQuery} ariaLabel="Search harnesses" placeholder="Search harnesses…" />
        <button
          type="button"
          onClick={() => {
            onChange(null);
            close();
          }}
          className={`${ROW_BASE} ${!value ? ROW_ON : ROW_OFF}`}
        >
          <span className="flex-1 truncate">All harnesses</span>
          {!value ? <Check size={12} /> : null}
        </button>
        {visible.map((option) => {
          const on = option.harness === value;
          return (
            <button
              key={option.harness}
              type="button"
              onClick={() => {
                onChange(option.harness);
                close();
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
        {visible.length === 0 ? (
          <div className="px-3 py-2 italic text-ink/40">No match for “{query.trim()}”</div>
        ) : null}
      </AnchoredMenu>
    </>
  );
}
