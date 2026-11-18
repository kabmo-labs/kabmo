/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's filter row: what the list is showing, which agent ran
 * it, plus the way into batch selection.
 *
 * Three axes and one mode, and they are not the same kind of thing:
 *
 * - **All / Running** are one choice — the focus. Selecting one deselects the
 *   other, so they are drawn as a segmented pair and report `aria-pressed`.
 * - **Archived** is a separate axis: it changes which rows are OFFERED, and it
 *   can be on at the same time as either focus. It carries a colour
 *   (`--theme-warning`) because an archived list is not the list the user
 *   expects, and that fact should not be readable only from a label.
 * - **Harness** is the other separate axis: a dropdown immediately right of
 *   `Archived`, because that is where the user looks for "which agent". Its two
 *   forms are chosen by measured width too (`filterRowForms`).
 * - **Select** enters batch mode. It has TWO forms, chosen by measured width:
 *   a trailing glyph while the row is narrow, and a chip once four chips fit.
 *   Either way it is the LAST item and it alone sits at the row's trailing edge
 *   (`ml-auto`) — the filter group never moves.
 *
 * **Only Select is right-aligned, never the chip group.** The group is a reading
 * order — All, Running, Archived — and it starts at the same left edge as the
 * search field and the rows below it. Pushing the group to the right edge when
 * the fourth chip appears (which is what this row did first) made the filters
 * jump sideways as the panel was dragged, and left them under the title column
 * instead of over it.
 *
 * **This row never wraps.** It is a control strip, and a second line of chips
 * pushes the list down and reads as a layout break: the four-chip version
 * measured 265px against 256px of content at the 280px default, which is what
 * `Select` falling onto a line of its own looked like. The harness control is
 * part of that budget, so adding it never pushes `Select` off the row — and at
 * the 264px floor, where even the narrow forms do not fit, it is the harness
 * control alone that wraps (`filterRowForms(...).wrap`), never a filter chip or
 * `Select`.
 */

import { Archive, ListChecks, X } from 'lucide-preact';
import { useToolbarRowWidth } from '@/client/hooks/workspace/toolbar-row-width';
import { HarnessFilter } from '@/client/components/layout/session-sidebar/HarnessFilter';
import { filterRowForms } from '@/shared/lib/workspace/sidebar-filter-row';
import type { HarnessFilterOption } from '@/shared/lib/workspace/harness-filter';
import type { SessionFocus } from '@/shared/lib/workspace/session-focus';

interface FilterChipsProps {
  focus: SessionFocus;
  onFocusChange: (focus: SessionFocus) => void;
  /** Rows the focus would keep, for the Running chip's badge. */
  runningCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  /** The harness the list is narrowed to, or null for every harness. */
  harnessFilter: string | null;
  onHarnessFilterChange: (harness: string | null) => void;
  /** The harnesses the list holds, with row counts — the filter's menu. */
  harnessOptions: HarnessFilterOption[];
  /** True while a batch selection is active — the control reads pressed. */
  selecting: boolean;
  /** Enter or leave workspace batch-selection mode. */
  onToggleSelect: () => void;
}

const CHIP_BASE = 'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer';
const CHIP_ON = 'border-ink bg-ink text-paper';
const CHIP_OFF = 'border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink';
const SELECT_LABEL = (selecting: boolean) => (selecting ? 'Cancel' : 'Select');

export function FilterChips({
  focus,
  onFocusChange,
  runningCount,
  showArchived,
  onToggleArchived,
  harnessFilter,
  onHarnessFilterChange,
  harnessOptions,
  selecting,
  onToggleSelect,
}: FilterChipsProps) {
  // Measured, not guessed: the sidebar is dragged, so the forms have to follow
  // the panel's real content width (see `filterRowForms`). The row carries no
  // padding of its own — its `px-3` lives on the wrapper — hence `0`.
  const { ref, width } = useToolbarRowWidth(0);
  const forms = filterRowForms(width, runningCount);
  const selectGlyph = selecting ? <X size={10} /> : <ListChecks size={10} />;

  // DOM order decides which control wraps when the row runs out of room. On a
  // wide row the harness sits before Select (right of Archived); on the narrow
  // fallback it sits AFTER Select, so the 22px Select glyph keeps the row's
  // trailing edge and the harness alone drops to a second line. Letting the
  // order stand would wrap Select instead — the one control the row exists to
  // keep reachable.
  const harness = (
    <HarnessFilter
      options={harnessOptions}
      value={harnessFilter}
      onChange={onHarnessFilterChange}
      // On its own line there is room for the label, so the fallback is the
      // full chip — the same control the row before this one drew.
      form={forms.wrap ? 'chip' : forms.harness}
    />
  );

  return (
    <div className="px-3 pb-2">
      <div ref={ref} className={`flex items-center gap-1 ${forms.wrap ? 'flex-wrap' : 'flex-nowrap'}`}>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Session filters">
          <button
            type="button"
            onClick={() => onFocusChange('all')}
            aria-pressed={focus === 'all'}
            className={`${CHIP_BASE} ${focus === 'all' ? CHIP_ON : CHIP_OFF}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onFocusChange('running')}
            aria-pressed={focus === 'running'}
            title={runningCount > 0 ? `${runningCount} running or waiting` : 'Nothing running'}
            className={`${CHIP_BASE} ${focus === 'running' ? CHIP_ON : CHIP_OFF}`}
          >
            {/* A dot, not a spinner: the chip reports a COUNT of rows, and a
                spinner here would claim the chip itself is loading. */}
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${runningCount > 0 ? 'bg-current' : 'bg-current opacity-30'}`}
            />
            Running
            {runningCount > 0 && <span className="font-mono tabular-nums opacity-70">{runningCount}</span>}
          </button>
          <button
            type="button"
            onClick={onToggleArchived}
            aria-pressed={showArchived}
            title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
            className={`${CHIP_BASE} ${
              showArchived ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15' : CHIP_OFF
            }`}
          >
            <Archive size={10} />
            Archived
          </button>
        </div>

        {/* The harness dropdown sits immediately right of `Archived`: it is a
            filter axis beside the archive one, not a mode. Its form is part of
            the row's budget, so a chip here can never push `Select` off. */}
        {forms.wrap ? null : harness}

        {/* Select is a SIBLING of the filter group, never a member of it. Inside
            the group `ml-auto` has no free space to claim — the group is
            `shrink-0` and only as wide as its chips — so the fourth chip landed
            immediately after `Archived` instead of at the row's trailing edge.
            Out here it is the row's own spare space that pushes it right. */}
        {forms.select === 'chip' ? (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selecting}
            title={selecting ? 'Cancel selection' : 'Select workspaces'}
            className={`${CHIP_BASE} ml-auto ${selecting ? CHIP_ON : CHIP_OFF}`}
          >
            {selectGlyph}
            {SELECT_LABEL(selecting)}
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleSelect}
            title={selecting ? 'Cancel selection' : 'Select workspaces'}
            aria-label={selecting ? 'Cancel selection' : 'Select workspaces'}
            aria-pressed={selecting}
            className={`ml-auto inline-flex shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer ${
              forms.select === 'mini' ? 'h-[22px] w-[22px]' : 'h-7 w-7'
            } ${selecting ? 'bg-ink/10 text-ink' : 'text-ink/55 hover:bg-ink/[0.06] hover:text-ink'}`}
          >
            {selecting
              ? <X size={forms.select === 'mini' ? 12 : 14} />
              : <ListChecks size={forms.select === 'mini' ? 12 : 14} />}
          </button>
        )}

        {/* The narrow fallback: after Select in DOM order, so the row's trailing
            glyph stays put and this control alone takes the second line. */}
        {forms.wrap ? harness : null}
      </div>
    </div>
  );
}
