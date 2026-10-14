/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A sparkline for one series.
 *
 * An inline `<svg>` with a single `polyline`, not a chart library: the kit has
 * no chart primitive, the chamber's own panels draw their distribution bars the
 * same way, and a dependency for one polyline would be the largest thing in the
 * plugin.
 *
 * The y-range is the series' own min/max rather than zero-based, because a
 * memory line that moves 3.6 → 3.8 GB would be a flat line against zero — the
 * shape is the point, and the numbers are printed beside it.
 */

interface SparklineProps {
  values: readonly number[];
  /** A fixed colour class, so the line follows the theme. */
  tone?: string;
  label: string;
}

export function Sparkline({ values, tone = 'text-info', label }: SparklineProps) {
  if (values.length < 2) {
    return (
      <div class="flex items-center gap-2">
        <span class="text-[10px] uppercase font-mono text-ink/40">{label}</span>
        <span class="text-[10px] font-mono text-ink/30">collecting…</span>
      </div>
    );
  }

  const width = 120;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has no range to normalise against; drawing it down the middle
  // is the honest picture of "nothing changed".
  const span = max - min;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div class="flex items-center gap-2">
      <span class="text-[10px] uppercase font-mono text-ink/40 w-12 flex-shrink-0">{label}</span>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        class={`${tone} flex-shrink-0`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} trend`}
      >
        <polyline points={points} fill="none" stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="text-[10px] font-mono text-ink/45 whitespace-nowrap">
        {min === max ? min.toFixed(1) : `${min.toFixed(1)} – ${max.toFixed(1)}`}
      </span>
    </div>
  );
}
