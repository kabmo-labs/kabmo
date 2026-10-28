/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff toolbar's hunk stepper: `‹ 2/5 ›`.
 *
 * Its own file for the per-file ceiling, and because it is the one cluster with
 * state to read — the others are toggles over a prop. The index is 0-based in
 * the view and 1-based on screen: "3 of 7" is what a reader counts, and `-1`
 * (the caret outside every chunk) prints an en dash rather than `0`.
 */

import { ChevronDown, ChevronUp } from 'lucide-preact';

const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink/50';

interface HunkStepperProps {
  /** 0-based, or -1 when the caret is not inside a chunk. */
  index: number;
  count: number;
  /** A git write or a reload is in flight; stepping a stale pair is misleading. */
  locked: boolean;
  onStep: (direction: 1 | -1) => void;
}

export function HunkStepper({ index, count, locked, onStep }: HunkStepperProps) {
  const position = index >= 0 ? index + 1 : '–';
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={locked}
        className={`${ACTION_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
        title="Previous change"
        aria-label="Previous change"
      >
        <ChevronUp size={13} />
      </button>
      <span
        className="text-[10px] font-mono tabular-nums text-ink/50 px-0.5 min-w-[3.5ch] text-center"
        title={`Changed hunk ${position} of ${count}`}
        aria-live="polite"
      >
        {position}/{count}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={locked}
        className={`${ACTION_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
        title="Next change"
        aria-label="Next change"
      >
        <ChevronDown size={13} />
      </button>
    </div>
  );
}
