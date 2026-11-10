/**
 * The tree lines in front of one row.
 *
 * One level is as wide as the distance from a row's leading-slot centre to its
 * harness mark centre, so the child row's indicator slot lands exactly under
 * the parent's harness icon. The line itself stays on the parent's chevron
 * column; what separates the two is VERTICAL — the first row of a branch starts
 * its stem `STEM_GAP` below the row (below the chevron ink) instead of running
 * up into the glyph.
 *
 * The strokes are 2px, the chevron's own ink weight, and each segment ABUTS the
 * next instead of overlapping it: a translucent `bg-ink/40` painted twice by
 * overlapping stems read as alternating dark bands ("belang") down a two-child
 * branch. The list's 2px row gap is covered by the segment above (bottom:-2px),
 * and the next row starts at its own top edge, so the line is continuous and
 * one-ply everywhere.
 */

import type { BranchRowStyle } from '@/client/components/common/session-branch/style';

export interface BranchGuidesProps {
  /** For each ancestor level, whether THAT ancestor was the last sibling. */
  ancestors: readonly boolean[];
  /** Whether this row is the last sibling at its own level. */
  isLast: boolean;
  /** The first row of the branch: the stem starts below the parent chevron. */
  first: boolean;
  style: BranchRowStyle;
}

/** The list's space-y gap, bridged by the segment above. */
const GAP = 2;
/** Vertical breathing room between the parent chevron and the stem. */
const STEM_GAP = 6;

export function BranchGuides({ ancestors, isLast, first, style }: BranchGuidesProps) {
  // Where the row's leading slot sits inside its box, and the pitch to its
  // harness mark: the next level's indicator targets that mark's centre.
  const slotCenter = style.insetPx + style.slotWidth / 2;
  const pitch = style.slotWidth / 2 + style.markGap + style.glyph / 2;
  // From the line to the child slot's left edge: the arm crosses the row inset.
  const arm = pitch + style.insetPx - slotCenter;
  // 2px matches the chevron's ink weight; offset by half its width to sit on
  // the icon's exact integer centre.
  const STROKE = 2;
  const line = slotCenter - STROKE / 2;

  const stem = first
    ? isLast
      // From below the chevron to THIS row's centre.
      ? { left: line, top: -STEM_GAP, height: `calc(50% + ${STEM_GAP}px)` }
      : { left: line, top: -STEM_GAP, bottom: -GAP }
    : isLast
      ? { left: line, top: 0, height: '50%' }
      : { left: line, top: 0, bottom: -GAP };

  return (
    <>
      {ancestors.map((ancestorIsLast, level) => (
        <span
          key={level}
          data-guide="ancestor"
          data-continues={ancestorIsLast ? undefined : 'true'}
          aria-hidden="true"
          className="relative shrink-0"
          style={{ width: pitch }}
        >
          {!ancestorIsLast && (
            <span
              className="absolute z-10 bg-ink/40"
              style={{ left: line, top: 0, bottom: -GAP, width: STROKE }}
            />
          )}
        </span>
      ))}
      <span
        data-guide="connector"
        data-last={isLast ? 'true' : undefined}
        data-first={first ? 'true' : undefined}
        aria-hidden="true"
        className="relative shrink-0"
        style={{ width: pitch }}
      >
        <span className="absolute z-10 bg-ink/40" style={{ width: STROKE, ...stem }} />
        {/* Above the row's background: the arm crosses its inset padding. */}
        <span
          className="absolute z-10 bg-ink/40"
          style={{ left: line, top: 'calc(50% - 1px)', width: arm + 1, height: STROKE }}
        />
      </span>
    </>
  );
}
