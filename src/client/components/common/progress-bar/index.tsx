/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A determinate progress bar: one track, one fill, one accessible value.
 *
 * Two surfaces need it — a batch delete's chunk progress and a wait panel's
 * elapsed share — and they used to be two hand-written tracks. The bar is the
 * same fact in both places, so it is stated once here; the callers own the
 * label and the tone, which is what actually differs.
 *
 * `percent` is clamped rather than trusted: a caller that divides by a count
 * that moved (a selection shrinking under a refresh) must not paint a fill
 * outside the track.
 */

export interface ProgressBarProps {
  /** 0–100. Values outside the range are clamped. */
  percent: number;
  /** Accessible name, e.g. `Deleting 615 sessions`. */
  label: string;
  /** `error` for a destructive run, `success` for a finished one, `ink` neutral. */
  tone?: 'ink' | 'error' | 'success';
  /** Track height and spacing, when the caller's row needs a different size. */
  className?: string;
}

const TONE_FILL: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  ink: 'bg-ink/60',
  error: 'bg-error',
  success: 'bg-success/70',
};

export function ProgressBar({ percent, label, tone = 'ink', className = 'h-1.5' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={`relative overflow-hidden rounded-full bg-ink/8 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
    >
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${TONE_FILL[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
