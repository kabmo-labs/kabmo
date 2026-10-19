/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The process table: one row per process, grouped by the session that owns it.
 *
 * Four rendering rules, each about not lying with a table:
 *
 * - **A row is TWO lines: a title and a detail.** One basename column made
 *   twelve of forty rows unreadable (`node` ten times, `cli.js` six), and every
 *   distinction was already in the data. The title says what the process IS; the
 *   detail says which project, which session, how old.
 * - **The group header is the OWNER's label, and it carries the rollup.** The
 *   figures sit in the SAME columns as the rows they sum, so a total lines up
 *   with what it totals. The memory is the whole subtree's — the number a reader
 *   wants and cannot get by adding rows by eye.
 * - **Depth is INDENTATION.** A session and everything it spawned read as one
 *   tree, so the chain (a host, its broker, the relay under it) is visible
 *   rather than flattened into alphabetical neighbours.
 * - **A row with no CPU reading shows `—`, never `0.0%`.** The first sample and
 *   a just-appeared process both have no rate, and `0.0%` claims they are idle.
 *
 * The TITLE line is drawn in the UI stack, not the mono one: omp heads a
 * session title with a card icon (a private-use glyph), and `--font-sans` is the
 * only stack that names a Nerd Font (`nerd-symbols.test.ts` pins that for
 * exactly this reason). Mono would render every session card as a tofu box.
 */


import type { ComponentChildren } from 'preact';

import { formatBytes, formatPercent } from './format';
import type { GroupSummary, ProcessRow, StatsSnapshot } from './sampler';

interface ProcessTableProps {
  snapshot: StatsSnapshot;
}

/** The colour a group's dot takes, so the list is scannable. */
const GROUP_TONE: Record<string, string> = {
  kabmo: 'bg-ink',
  session: 'bg-success',
  utility: 'bg-info',
  prewarm: 'bg-ink/30',
  daemon: 'bg-error',
  broker: 'bg-error/60',
  terminal: 'bg-warning',
  other: 'bg-ink/25',
};

function dotClass(kind: string): string {
  return GROUP_TONE[kind] ?? 'bg-ink/25';
}

/**
 * The table's own container, so the column set follows the PANEL's width.
 *
 * The query must be on this element, not the viewport: the panel is 420px wide
 * on a 1600px screen, so a `sm:`-style breakpoint never fires. `@container`
 * makes the children's `@[NNNpx]:` variants resolve against this box.
 */
function TableShell({ children }: { children: ComponentChildren }) {
  return <div class="@container w-full">{children}</div>;
}

/** One column label. `align` matches the cells below it. */
function HeaderCell({
  label,
  align = 'left',
  title,
  class: extra,
}: {
  label: string;
  align?: 'left' | 'right';
  title?: string;
  class?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      class={`py-1 pr-2 font-mono text-[10px] font-medium uppercase text-ink/45 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${extra ?? ''}`}
    >
      {label}
    </th>
  );
}

/** The indent a depth takes, capped so a deep chain cannot walk off the panel. */
function indent(depth: number): string {
  return '  '.repeat(Math.min(depth, 4));
}

function ProcessRowView({ row, serverPid }: { row: ProcessRow; serverPid: number }) {
  const pad = indent(row.depth);
  return (
    <tr class="border-t border-ink/5 hover:bg-ink/[0.02]">
      <td class="py-1 pr-2 align-top text-right font-mono text-[10px] text-ink/45 w-14">
        {row.pid}
        {row.pid === serverPid ? <span class="block text-[8px] text-ink/35">self</span> : null}
      </td>
      <td class="py-1 pr-2 align-top min-w-0">
        <div class="font-sans text-[11px] text-ink truncate" title={`${pad}${row.title}`}>
          {pad}
          {row.title}
        </div>
        {row.detail ? (
          <div class="font-mono text-[10px] text-ink/40 truncate" title={row.detail}>
            {pad}
            {row.detail}
          </div>
        ) : null}
      </td>
      <td class="py-1 pr-2 align-top text-right font-mono text-[11px] text-ink whitespace-nowrap w-16">
        {formatBytes(row.rss)}
      </td>
      <td class="py-1 pr-2 align-top text-right font-mono text-[11px] text-ink/70 whitespace-nowrap w-14 @max-[360px]:hidden">
        {formatPercent(row.cpuPercent)}
      </td>
      <td class="py-1 pr-2 align-top text-right font-mono text-[10px] text-ink/40 w-9 @max-[300px]:hidden">
        {row.threads > 0 ? row.threads : ''}
      </td>
    </tr>
  );
}

/**
 * The rollup row that opens each group.
 *
 * The DOT lives in the PID column, not beside the label, so the group's name
 * lines up with the process names below it — a dot inside the `Process` cell
 * pushes its text right by the dot's width plus the gap, which is the one row in
 * the table whose text would not start where the reader expects. The figures go
 * in the SAME columns as the rows they sum.
 */
function GroupRow({ group }: { group: GroupSummary }) {
  return (
    <tr class="bg-canvas border-t border-ink/10">
      <td class="py-1.5 pr-2 w-14">
        <span class="flex justify-end">
          <span class={`w-1.5 h-1.5 rounded-full ${dotClass(group.kind)}`} />
        </span>
      </td>
      <td class="py-1.5 pr-2 min-w-0">
        <div class="flex items-baseline gap-2 min-w-0">
          <span class="font-sans text-[11px] font-semibold text-ink truncate" title={group.title}>
            {group.kind === 'daemon' || group.kind === 'broker' ? '⇄ ' : ''}
            {group.title}
          </span>
          <span class="text-[10px] font-mono text-ink/40 whitespace-nowrap">
            {group.processes} {group.processes === 1 ? 'process' : 'processes'}
          </span>
        </div>
        {group.detail ? (
          <div class="font-mono text-[10px] text-ink/40 truncate" title={group.detail}>
            {group.detail}
          </div>
        ) : null}
      </td>
      <td class="py-1.5 pr-2 text-right font-mono text-[10px] text-ink/60 whitespace-nowrap w-16">
        {formatBytes(group.rss)}
      </td>
      <td class="py-1.5 pr-2 text-right font-mono text-[10px] text-ink/60 whitespace-nowrap w-14 @max-[360px]:hidden">
        {formatPercent(group.cpuPercent)}
      </td>
      <td class="py-1.5 pr-2 w-9 @max-[300px]:hidden" />
    </tr>
  );
}

export function ProcessTable({ snapshot }: ProcessTableProps) {
  const rowsByGroup = new Map<string, ProcessRow[]>();
  for (const row of snapshot.rows) {
    const bucket = rowsByGroup.get(row.groupKey);
    if (bucket) bucket.push(row);
    else rowsByGroup.set(row.groupKey, [row]);
  }

  return (
    // ONE table, so the header is stated once and stays pinned while the list
    // scrolls. A table per group would have to repeat it, and the labels are the
    // thing that must not be ambiguous.
    <TableShell>
      <table class="w-full table-fixed">
        {/* `-top-3` is the host scroller's own `p-3`, negated. A sticky `top-0`
          sticks at the CONTENT box — below the container's padding — so the
          12px band between the scrollport edge and the header stayed visible
          and rows scrolled through it (measured: a dark text pixel at the very
          top of the panel, above the pinned labels). Sticking at the padding
          edge instead makes the header cover that band, which is what the
          wrapper's own `-m-3 p-2` already assumes. */}
        {/* The bottom rule is a `box-shadow`, not a `border-b`. With
            `border-collapse: collapse` a border on a sticky header does not
            travel with it: measured while pinned, the rule rendered as a
            broken run (112 of 776px) because each cell draws its own edge
            against the rows scrolling under it. A shadow on the `thead`
            paints one continuous line (776/776px) and sits above the rows
            rather than between them. */}
        <thead class="sticky -top-3 z-20 bg-paper shadow-[0_1px_0_0_color-mix(in_srgb,var(--theme-ink)_15%,transparent)]">
          <tr>
            <HeaderCell label="PID" align="right" title="Operating-system process id" class="w-14" />
            <HeaderCell label="Process" title="What it is, and the project, session and age behind it" />
            <HeaderCell label="Memory" align="right" title="Resident set size (RSS)" class="w-16" />
            <HeaderCell
              label="CPU"
              align="right"
              title="CPU time over the last sample interval"
              class="w-14 @max-[360px]:hidden"
            />
            <HeaderCell label="Thr" align="right" title="Thread count" class="w-9 @max-[300px]:hidden" />
          </tr>
        </thead>
        {snapshot.groups.map((group) => {
          const rows = rowsByGroup.get(group.key) ?? [];
          return (
            <tbody key={group.key}>
              <GroupRow group={group} />
              {rows
                .slice()
                // Owner first, then the tree in BFS order, and only then by size:
                // sorting by RSS alone put a 719 MB grandchild above the process
                // that spawned it, which is the one row the group is about.
                .sort((a, b) => a.depth - b.depth || b.rss - a.rss)
                .map((row) => (
                  <ProcessRowView key={row.pid} row={row} serverPid={snapshot.serverPid} />
                ))}
            </tbody>
          );
        })}
      </table>
    </TableShell>
  );
}
