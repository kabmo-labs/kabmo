import { useState } from 'preact/hooks';
import type { UserTurnRef } from '@/shared/types';
import { formatMessageStamp } from '@/shared/lib/format/time';

interface MinimapShortcutsProps {
  /** Every user turn of the session, oldest first — not just the mounted
   *  window, so the rail lists the whole conversation while the timeline holds
   *  one page of it. */
  turns: UserTurnRef[];
  /** A jump is paging history to reach the clicked turn. */
  jumping: boolean;
  onJumpTurn: (turn: UserTurnRef) => void;
}

/** Row pitch the rail keeps while it fits: a 1px line with 3px of breathing
 *  room on each side — the spacing the hover wave was drawn around. */
const ROW_PITCH_MAX = '7px';
/** Rows never collapse below this, so a tick stays clickable. */
const ROW_PITCH_MIN = '2px';
/** Target ceiling for the rail as a share of the viewport: a session long
 *  enough to overflow it tightens its rows rather than growing past the
 *  timeline. Past the minimum pitch the class-level `max-h` takes over, so a
 *  session with hundreds of turns still keeps every tick on screen. */
const RAIL_TARGET_HEIGHT = '60vh';

/**
 * Jump rail: one tick per user turn of the FULL history. A turn outside the
 * mounted window is still clickable — the click pages older windows in until
 * that row exists, then centers it.
 */
export function MinimapShortcuts({ turns, jumping, onJumpTurn }: MinimapShortcutsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  if (turns.length === 0) return null;

  // Rows are laid out in normal flow (never absolutely positioned), so their
  // hit boxes cannot overlap and each tick keeps its own hover.
  const rowPitch = `clamp(${ROW_PITCH_MIN}, calc(${RAIL_TARGET_HEIGHT} / ${turns.length}), ${ROW_PITCH_MAX})`;

  const lineWidth = (idx: number): string => {
    if (hoveredIdx === null) return 'w-3';
    const dist = Math.abs(idx - hoveredIdx);
    if (dist === 0) return 'w-6';
    if (dist === 1) return 'w-4';
    return 'w-3';
  };

  return (
    <div
      className={`absolute right-0.5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center py-4 w-6 max-h-[min(60vh,100%)] ${jumping ? 'animate-pulse' : ''}`}
      role="navigation"
      aria-label={`Jump to your message (${turns.length} turns)`}
      onMouseLeave={() => setHoveredIdx(null)}
    >
      {turns.map((turn, idx) => {
        const isHovered = hoveredIdx === idx;
        return (
          <div
            key={`minimap-${turn.id}`}
            className="relative flex min-h-0 items-center justify-center w-full"
            style={{ height: rowPitch }}
            onMouseEnter={() => setHoveredIdx(idx)}
          >
            {/* The row IS the control. The tick is a 1px line at the row's
                vertical centre — the obvious thing to aim at — so leaving it
                as its own element put a dead, `cursor: default` 12x1 box over
                the middle of a 24x7 target: the tooltip appeared (the row's
                own mouseenter) while the cursor stayed an arrow and the click
                landed on an element with no handler. One absolutely-positioned
                button spans the whole row, so every pixel of it — the line
                included — is a pointer target and a keyboard stop. */}
            <button
              type="button"
              className="absolute inset-0 cursor-pointer"
              aria-label={`Jump to your message #${idx + 1} of ${turns.length}`}
              onClick={() => onJumpTurn(turn)}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none block h-px rounded-full transition-all duration-200 ease-out ${lineWidth(idx)} ${isHovered ? 'bg-ink h-[2px]' : 'bg-ink/25'}`}
            />
            <div
              className={`absolute right-full mr-3 top-1/2 -translate-y-1/2 w-64 p-3 bg-ink text-canvas text-xs rounded-md shadow-lg pointer-events-none transition-opacity duration-200 z-30 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
            >
              <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-canvas/20 font-mono text-[10px] uppercase tracking-wider text-canvas/60">
                <span>#{idx + 1} of {turns.length}</span>
                {formatMessageStamp(turn) && <span>{formatMessageStamp(turn)}</span>}
              </div>
              <div className="line-clamp-3 whitespace-pre-wrap leading-relaxed">{turn.preview.trim() || '(no text)'}</div>
              <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 bg-ink rotate-45" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
