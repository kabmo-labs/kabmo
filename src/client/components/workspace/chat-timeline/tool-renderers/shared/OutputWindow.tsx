/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window of tool output actually mounted.
 *
 * A panel used to keep 1000 lines (`MAX_OUTPUT_LINES`) and mount all of them
 * inside a `max-h-72` box — 288px holding ~15 visible rows and 985 nobody can
 * see. The search panel measured what that costs at scale (34s of blocked main
 * thread for one scroll over 19,376 mounted rows), and the same shape applies
 * here on every long build log.
 *
 * The slice comes from `outputWindow` (pure, tested); this component owns only
 * the control and the "N earlier lines hidden" line, so every long output
 * reveals by the same amount.
 */

import { ChevronUp, Info } from 'lucide-preact';
import type { ReactNode } from 'preact/compat';
import { canRevealMore, outputWindow } from '@/shared/lib/chat/tool/output-window';
import { useOutputReveal } from '@/client/hooks/ui/output-reveal';

interface OutputWindowProps {
  /** Every line the panel kept, in order. */
  lines: string[];
  /** Render the visible slice. Called with the slice, not the full array. */
  render: (visible: string[]) => ReactNode;
  /** Class for the scroller, so a caller keeps its own height ceiling. */
  className?: string;
}

/** The reveal control plus its "N hidden" note, shown only when lines are. */
export function OutputWindow({ lines, render, className }: OutputWindowProps) {
  const { revealed, reveal } = useOutputReveal(lines.length);
  const window = outputWindow(lines.length, revealed);
  const visible = lines.slice(window.start, window.end);
  const more = canRevealMore(revealed, lines.length);

  return (
    <>
      {window.hidden > 0 && (
        <div className="flex items-center gap-2 border-b border-ink/6 bg-canvas/40 px-3 py-1 font-mono text-[9.5px] text-ink/45">
          <Info size={10} className="shrink-0" />
          <span>… {window.hidden} earlier lines hidden</span>
          {more && (
            <button
              type="button"
              onClick={reveal}
              className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-ink/55 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <ChevronUp size={10} />
              Show earlier
            </button>
          )}
        </div>
      )}
      <div className={className}>{render(visible)}</div>
    </>
  );
}
