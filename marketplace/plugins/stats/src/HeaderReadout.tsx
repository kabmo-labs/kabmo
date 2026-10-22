/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The navbar readout: CPU and RAM for the whole omp stack, two columns wide.
 *
 * ## It is a readout, not a control
 *
 * The host wraps this component in the button that opens the panel (the
 * registration's `opensPanel`), so nothing here is clickable, focusable or
 * keyboard-reachable. That split is the header contract: a trigger renders what
 * the entry READS, and the host owns the interaction.
 *
 * ## Two lines, because the labels and the figures answer different questions
 *
 * ```
 * CPU   RAM
 * 18%   2.5G
 * ```
 *
 * The labels are 9px uppercase mono and muted; the figures are 12px mono and
 * full ink. That is the header's own type scale (`context-usage-button`'s ring
 * label sits at the same size), and the contrast is what lets the numbers be
 * scanned without reading the words above them twice.
 *
 * ## It samples while it is on screen, and only then
 *
 * A figure nobody is looking at costs a process-table sweep per tick, so the
 * readout arms the server's sampler on mount and disarms it on unmount — the
 * same `watch`/`unwatch` pair the panel uses, which is why the two can be open
 * at once without the loop being armed twice. A BACKGROUND tab is not looking:
 * the watch is released while the document is hidden, so a tab left open
 * overnight does not sample until it is brought forward again.
 *
 * ## The states that are not zero
 *
 * - **No sample yet** — the first tick carries RSS and no CPU rate, so the CPU
 *   column reads `—` rather than `0%`.
 * - **The server half is not loaded** — a plugin installed into a running Kabmo
 *   answers no `watch` and no topic. The readout then reads `—` in both
 *   columns; the panel itself explains why, and a header has no room to.
 * - **A platform with no probe** — the snapshot says so and both columns read
 *   `—`.
 */

import { useEffect, useState } from 'preact/hooks';
import { useRealtime, useRpc } from '@kabmo-labs/kabmo-ui';

import { formatCompactBytes, formatCompactPercent } from './format';
import type { StatsSnapshot } from './sampler';

/**
 * Whether this tab is being looked at.
 *
 * `visibilityState` rather than a focus check: a window that is visible but not
 * focused is still on screen, and its readout still has a reader.
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** One column of the readout: a label above, a figure below. */
function ReadoutCell({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span class="flex flex-col leading-none" title={title}>
      <span class="text-[9px] uppercase font-mono text-ink/40 tracking-wide">{label}</span>
      <span class="text-[12px] font-mono font-semibold text-ink tabular-nums">{value}</span>
    </span>
  );
}

export function StatsHeaderReadout() {
  const realtime = useRealtime<StatsSnapshot>();
  const watch = useRpc<undefined, { watching: number }>('watch');
  const unwatch = useRpc<undefined, { watching: number }>('unwatch');
  const visible = useDocumentVisible();

  // Arm while the readout is on screen and the tab is visible. The cleanup
  // always unwatches: a mount that failed to arm answers `plugin_not_loaded`
  // and decrements to zero, which the server clamps — the alternative is a
  // counter that drifts up on every failed load and never releases the loop.
  useEffect(() => {
    if (!visible) return;
    void watch.call(undefined);
    return () => {
      void unwatch.call(undefined);
    };
    // `call` is stable per method+plugin; the effect keys on what it means.
  }, [visible, watch.call, unwatch.call]);

  const snapshot = realtime.value;
  const measurable = snapshot !== null && snapshot.probe.supported;
  const cpu = measurable ? formatCompactPercent(snapshot.total.cpuPercent) : '—';
  const ram = measurable ? formatCompactBytes(snapshot.total.rss) : '—';
  // A figure with no sample behind it must not look like a measurement: the
  // tooltip is the only place the header can say so.
  const title = measurable
    ? `omp stack — ${ram} RAM, ${cpu} CPU. Click for the process table.`
    : 'Stats — no measurement yet. Click for details.';

  return (
    <span class="flex items-center gap-2.5" aria-label={`CPU ${cpu}, RAM ${ram}`} title={title}>
      <ReadoutCell label="CPU" value={cpu} title="CPU over the last sample interval, across every process" />
      <ReadoutCell label="RAM" value={ram} title="Resident memory across every process" />
    </span>
  );
}
