/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The badge that names WHICH agent produced a run.
 *
 * Two surfaces draw it — the docked generating indicator and a run's answer
 * footer — and both used to hardcode `lucide`'s `Bot`. That is the wrong claim
 * once a chat can run on any harness: an `opencode` session announced itself
 * with a robot, so the one place the app says "which agent is working" named
 * omp for every agent. One component, so the two surfaces cannot disagree
 * about the mark, its size, or its fallback.
 *
 * The badge is an INVERTED surface (`bg-ink`, so it is dark on a light theme
 * and light on a dark one). The mark therefore paints from `text-canvas`
 * (`inherit`) rather than the glyph's default muted ink, and the colour mode's
 * `.bg-ink svg[data-harness]` rule keeps it on that foreground instead of a
 * brand hue.
 *
 * A harness this build cannot name — an unknown id arriving over the wire, or
 * a session recorded before harnesses were — falls back to `Bot` rather than
 * rendering an empty square.
 */

import { Bot } from 'lucide-preact';
import { HarnessGlyph } from '@/client/components/common/harness-glyph';
import { harnessDescriptor } from '@/shared/lib/harness/catalog';

interface RunMarkProps {
  /** The run's harness id (`omp-rpc`, `opencode`, `claude`, …). */
  harness?: string | null;
  /** Badge edge in px. The mark inside is sized from it. */
  size?: number;
  /** Extra classes for the badge (the indicator's ring needs `relative z-10`). */
  className?: string;
  /**
   * Badge corner radius. The indicator's badge sits inside the spun ring's
   * 5px box, so it is drawn a shade tighter than a footer's `rounded`; a
   * SECOND radius utility in `className` would be resolved by Tailwind's
   * emission order, not by the order they are written, so it is a prop.
   */
  radiusClass?: string;
}

export function RunMark({ harness, size = 16, className = '', radiusClass = 'rounded' }: RunMarkProps) {
  const markSize = Math.max(8, Math.round(size * 0.625));
  return (
    <div
      className={`w-4 h-4 ${radiusClass} flex items-center justify-center bg-ink text-canvas shadow-2xs shrink-0 ${className}`}
    >
      {harnessDescriptor(harness)
        ? <HarnessGlyph harness={harness} size={markSize} inherit />
        : <Bot size={markSize} />}
    </div>
  );
}
