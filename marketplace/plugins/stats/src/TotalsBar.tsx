/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The totals strip: what the whole omp stack is using, against the machine.
 *
 * The two halves are deliberately separate and never collapsed. "omp is using
 * 3.7 GB" is only meaningful against "of 16 GB", and a single percentage the
 * panel computed from its own numbers would be a ratio of two things it
 * measured — which is exactly the kind of figure that reads authoritative and
 * is not.
 */

import { Field, FieldList, Note } from '@kabmo-labs/kabmo-ui/components';

import { RefreshButton } from './RefreshButton';
import { formatBytes, formatPercent } from './format';
import type { StatsSnapshot } from './sampler';

interface TotalsBarProps {
  snapshot: StatsSnapshot;
  /** Take a sample now. */
  onRefresh: () => void;
  /** A sample is in flight. */
  refreshing: boolean;
}

export function TotalsBar({ snapshot, onRefresh, refreshing }: TotalsBarProps) {
  const { total, machine, probe } = snapshot;
  const memoryShare = machine.totalMemBytes > 0 ? (total.rss / machine.totalMemBytes) * 100 : null;

  return (
    <div class="flex flex-col gap-3 border-b border-ink/10 px-3 py-3">
      <div class="flex items-center gap-2">
        <span class="text-[10px] uppercase font-mono text-ink/40">Stack</span>
        {/* The refresh lives here rather than beside the age stamp: this strip
            is the first thing in the panel, and a control a reader has to hunt
            for at the bottom of a scrolling list is one they will not find. */}
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} className="ml-auto" />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="flex flex-col gap-0.5">
          <span class="text-[10px] uppercase font-mono text-ink/40">Memory</span>
          <span class="text-sm font-semibold font-mono text-ink">{formatBytes(total.rss)}</span>
          <span class="text-[10px] font-mono text-ink/45">
            {memoryShare === null ? 'machine unknown' : `${memoryShare.toFixed(1)}% of ${formatBytes(machine.totalMemBytes)}`}
          </span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-[10px] uppercase font-mono text-ink/40">CPU</span>
          <span class="text-sm font-semibold font-mono text-ink">{formatPercent(total.cpuPercent)}</span>
          <span class="text-[10px] font-mono text-ink/45">
            {machine.cpuCount > 0 ? `${machine.cpuCount} cores` : 'cores unknown'}
          </span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-[10px] uppercase font-mono text-ink/40">Processes</span>
          <span class="text-sm font-semibold font-mono text-ink">{total.processes}</span>
          <span class="text-[10px] font-mono text-ink/45">
            load {machine.loadPerCore.toFixed(2)}/core
          </span>
        </div>
      </div>

      {snapshot.error ? <Note tone="error">{snapshot.error}</Note> : null}

      {!probe.supported && !snapshot.error ? (
        <Note tone="error">No process probe on this platform ({probe.name}).</Note>
      ) : null}

      {/* The first sample has no CPU: a rate needs two readings. Saying so is
          the honest alternative to a `0.0%` that reads as "idle". The test is
          the ROWS, not the history — `history` is present from the first
          sample whenever `historyPoints > 0` (the default), so gating on its
          absence made this note unreachable. */}
      {snapshot.rows.length > 0 && snapshot.rows.every((row) => row.cpuPercent === null) ? (
        <Note>First sample — CPU appears on the next tick.</Note>
      ) : null}
    </div>
  );
}

/** The machine's own numbers, for a reader who wants the denominator. */
export function MachineFacts({ snapshot }: { snapshot: StatsSnapshot }) {
  const { machine } = snapshot;
  return (
    <FieldList>
      <Field label="total memory" value={formatBytes(machine.totalMemBytes)} />
      <Field label="free memory" value={formatBytes(machine.freeMemBytes)} />
      <Field label="cores" value={String(machine.cpuCount)} />
      <Field label="load (1m/core)" value={machine.loadPerCore.toFixed(3)} />
    </FieldList>
  );
}
