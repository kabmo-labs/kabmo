/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Presentation for the context-window indicator: which band a usage share falls
 * in, the tone that band draws in, and the arc geometry of the ring.
 *
 * The bands are a product decision, stated once here because two layouts draw
 * the same indicator and a second table is how one of them ends up green while
 * the other is amber at the same percentage:
 *
 *   - under 50% healthy (success),
 *   - 50% up to 60% elevated (warning),
 *   - 60% and above critical (error).
 *
 * omp's typical compaction point is 80% of the window (`compaction.thresholdPercent`
 * ships an 80% preset labelled "Typical threshold"), so red begins well before
 * the agent starts spending its headroom on a summary — the point of the ring is
 * to be visible while there is still room to act.
 */

/** One of the three bands the ring can read. */
export type ContextUsageBand = 'healthy' | 'warning' | 'critical';

/** At or above this share the ring turns amber. */
export const CONTEXT_WARNING_PERCENT = 50;

/** At or above this share the ring turns red. */
export const CONTEXT_CRITICAL_PERCENT = 60;

/** Clamp a share into `0..100`; a missing or non-finite value reads as empty. */
export function clampContextPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/** The band a usage share falls in. Boundaries belong to the WORSE band. */
export function contextUsageBand(percent: number): ContextUsageBand {
  const clamped = clampContextPercent(percent);
  if (clamped >= CONTEXT_CRITICAL_PERCENT) return 'critical';
  if (clamped >= CONTEXT_WARNING_PERCENT) return 'warning';
  return 'healthy';
}

/**
 * The Tailwind classes for a band. The ring paints its arc with
 * `currentColor`, so the tone is a text class; the popover's status dot needs
 * the same colour as a background, and deriving one from the other with a
 * string replace is how the two drift apart.
 */
export const CONTEXT_BAND_TONES: Record<ContextUsageBand, { text: string; fill: string }> = {
  healthy: { text: 'text-success', fill: 'bg-success' },
  warning: { text: 'text-warning', fill: 'bg-warning' },
  critical: { text: 'text-error', fill: 'bg-error' },
};

export interface ContextRingGeometry {
  radius: number;
  circumference: number;
  /** `stroke-dashoffset` for the filled share: 0 at 100%, `circumference` at 0%. */
  dashOffset: number;
}

/**
 * Ring geometry for a `size`-px box with a `strokeWidth`-px arc.
 *
 * The radius is measured to the CENTRE of the stroke, so the arc never clips:
 * a naive `size / 2` puts half the stroke outside the viewBox.
 */
export function contextRingGeometry(percent: number, size: number, strokeWidth: number): ContextRingGeometry {
  const radius = Math.max(0, (size - strokeWidth) / 2);
  const circumference = 2 * Math.PI * radius;
  const filled = clampContextPercent(percent) / 100;
  return { radius, circumference, dashOffset: circumference * (1 - filled) };
}
