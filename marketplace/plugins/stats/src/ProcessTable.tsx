/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The process table: one row per process, heaviest first, grouped by category.
 *
 * Three rendering rules, each about not lying with a table:
 *
 * - **The columns are LABELLED, once, in a sticky header.** A row of bare
 *   numbers (`417.5 MB`, `1.5%`, `41`) is unreadable without one: nothing in the
 *   row says which figure is memory, which is CPU, or what the trailing number
 *   counts. The header is drawn once for the whole list rather than per group,
 *   so the groups stay visually separate without repeating the labels.
 * - **The category rollup is always drawn, even for one process.** A category
 *   with a single child is where the totals come from, and hiding it would make
 *   the header's number unreconcilable with the rows below it. Its figures sit
 *   in the SAME columns as the rows they sum, so a total lines up with what it
 *   totals.
 * - **A row with no CPU reading shows `—`, never `0.0%`.** The first sample and
 *   a just-appeared process both have no rate, and `0.0%` claims they are idle.
 */

import { formatBytes, formatPercent, categoryLabel, categoryRank } from './format';
import type { StatsSnapshot, ProcessRow } from './sampler';

interface ProcessTableProps {
  snapshot: StatsSnapshot;
}

/** The colour a category's dot takes, so a group is scannable. */
const DOT_TONE: Record<string, string> = {
  chamber: 'bg-ink',
  omp: 'bg-info',
  terminal: 'bg-success',
  dictation: 'bg-warning',
  tray: 'bg-ink/50',
  other: 'bg-ink/25',
};

function dotClass(category: string): string {
  if (DOT_TONE[category]) return DOT_TONE[category];
  return category.startsWith('daemon:') ? 'bg-error' : 'bg-ink/25';
}

/** The column widths, shared by the header and every row. */
const COLUMNS = (
  <colgroup>
    <col style="width:3.75rem" />
    <col />
    <col style="width:4.5rem" />
    <col style="width:3.75rem" />
    <col style="width:2.25rem" />
    <col style="width:2.5rem" />
  </colgroup>
);

/** One column label. `align` matches the cells below it. */
function HeaderCell({ label, align = 'left', title }: { label: string; align?: 'left' | 'right'; title?: string }) {
  return (
    <th
      scope="col"
      title={title}
      class={`px-0 py-1 font-mono text-[10px] font-medium uppercase text-ink/45 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {label}
    </th>
  );
}

function ProcessRowView({ row, serverPid }: { row: ProcessRow; serverPid: number }) {
  return (
    <tr class="border-t border-ink/5 hover:bg-ink/[0.02]">
      <td class="py-1 pr-2 text-right font-mono text-[10px] text-ink/45">{row.pid}</td>
      <td class="py-1 pr-2 font-mono text-[11px] text-ink truncate max-w-0" title={row.command}>
        {row.command}
      </td>
      <td class="py-1 pr-2 text-right font-mono text-[11px] text-ink whitespace-nowrap">{formatBytes(row.rss)}</td>
      <td class="py-1 pr-2 text-right font-mono text-[11px] text-ink/70 whitespace-nowrap">
        {formatPercent(row.cpuPercent)}
      </td>
      <td class="py-1 text-right font-mono text-[10px] text-ink/40">{row.threads > 0 ? row.threads : ''}</td>
      <td class="py-1 pl-1 text-[9px] font-mono text-ink/35">{row.pid === serverPid ? 'self' : ''}</td>
    </tr>
  );
}

/**
 * The rollup row that opens each group.
 *
 * The DOT lives in the PID column, not beside the label, and that is what makes
 * a group's name line up with the process names below it. A dot inside the
 * `Process` cell pushes its text right by the dot's width plus the gap, so every
 * group heading sat a few pixels off the column it names — the one row in the
 * table whose text did not start where the reader expects. The dot is decoration
 * for the group, so it belongs in the column that holds no text of its own.
 *
 * The figures go in the SAME columns as the rows they sum, so a total is never
 * a number without a column.
 */
function GroupRow({ group }: { group: StatsSnapshot['totals'][number] }) {
  return (
    <tr class="bg-canvas border-t border-ink/10">
      <td class="py-1.5 pr-2">
        <span class="flex justify-end">
          <span class={`w-1.5 h-1.5 rounded-full ${dotClass(group.category)}`} />
        </span>
      </td>
      <td class="py-1.5 pr-2 min-w-0">
        <span class="flex items-baseline gap-2 min-w-0">
          <span class="text-[11px] font-semibold text-ink truncate" title={group.category}>
            {categoryLabel(group.category)}
          </span>
          <span class="text-[10px] font-mono text-ink/40 whitespace-nowrap">
            {group.processes} {group.processes === 1 ? 'process' : 'processes'}
          </span>
        </span>
      </td>
      <td class="py-1.5 pr-2 text-right font-mono text-[10px] text-ink/60 whitespace-nowrap">
        {formatBytes(group.rss)}
      </td>
      <td class="py-1.5 pr-2 text-right font-mono text-[10px] text-ink/60 whitespace-nowrap">
        {formatPercent(group.cpuPercent)}
      </td>
      <td />
      <td />
    </tr>
  );
}

export function ProcessTable({ snapshot }: ProcessTableProps) {
  const totals = [...snapshot.totals].sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  const rowsByCategory = new Map<string, ProcessRow[]>();
  for (const row of snapshot.rows) {
    const bucket = rowsByCategory.get(row.category);
    if (bucket) bucket.push(row);
    else rowsByCategory.set(row.category, [row]);
  }

  return (
    // ONE table, so the header is stated once and stays pinned while the list
    // scrolls. A table per group would have to repeat it, and the labels are the
    // thing that must not be ambiguous.
    <table class="w-full table-fixed">
      {COLUMNS}
      <thead class="sticky top-0 z-20 bg-paper">
        <tr class="border-b border-ink/15">
          <HeaderCell label="PID" align="right" title="Operating-system process id" />
          <HeaderCell label="Process" title="Executable, or the script a runtime is running" />
          <HeaderCell label="Memory" align="right" title="Resident set size (RSS)" />
          <HeaderCell label="CPU" align="right" title="CPU time over the last sample interval" />
          <HeaderCell label="Thr" align="right" title="Thread count" />
          <HeaderCell label="" />
        </tr>
      </thead>
      {totals.map((group) => {
        const rows = rowsByCategory.get(group.category) ?? [];
        return (
          <tbody key={group.category}>
            <GroupRow group={group} />
            {rows.map((row) => (
              <ProcessRowView key={row.pid} row={row} serverPid={snapshot.serverPid} />
            ))}
          </tbody>
        );
      })}
    </table>
  );
}
