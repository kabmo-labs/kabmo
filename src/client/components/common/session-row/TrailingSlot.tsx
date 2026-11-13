/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The trailing column of a `modern` session row: the age at rest, the actions
 * trigger on hover.
 *
 * The two share ONE box because they answer the same question — "which of these
 * identically-titled chats is this?" — and the row cannot afford both at the
 * width a sidebar actually has (264px at its floor leaves ~176px for the
 * title). The trigger is always in the DOM and always hit-testable: only its
 * OPACITY moves, so a keyboard user reaches it with Tab, a browser spec clicks
 * it by role and name, and nothing becomes unreachable when the pointer is
 * elsewhere. On a touch row there is no hover to reveal anything, so both are
 * drawn side by side.
 *
 * The trigger's BOX is 22px on desktop and 28px on touch — the same boxes the
 * workspace header's action cluster uses, so the two `⋯` columns share one
 * centre. A box that merely fit the glyph (14px + a 4px pad) put the row's dots
 * 2px left of the header's on touch.
 */

import type { TargetedMouseEvent } from 'preact';
import { MoreHorizontal } from 'lucide-preact';

export interface TrailingSlotProps {
  timeAgo?: string | null;
  /** Full timestamp shown as the age's hover tooltip. */
  timeTitle?: string | null;
  /** Null when the row has nothing to offer a menu. */
  onOpenMenu?: (event: TargetedMouseEvent<HTMLElement>) => void;
  menuOpen?: boolean;
  touch?: boolean;
}

export function TrailingSlot({ timeAgo, timeTitle, onOpenMenu, menuOpen = false, touch = false }: TrailingSlotProps) {
  if (!onOpenMenu) {
    return timeAgo
      ? <span className="ml-2 shrink-0 font-mono text-[10px] text-ink/40" title={timeTitle ?? undefined}>{timeAgo}</span>
      : null;
  }

  const trigger = (
    <button
      type="button"
      onClick={onOpenMenu}
      title="Session actions"
      aria-label="Session actions"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      className={`shrink-0 rounded text-ink/40 hover:bg-ink/10 hover:text-ink cursor-pointer ${
        touch ? 'p-1.5' : 'p-1'
      } ${
        touch ? '' : 'opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100 focus-visible:opacity-100'
      }`}
    >
      <MoreHorizontal size={touch ? 16 : 14} />
    </button>
  );

  if (touch) {
    return (
      <span className="ml-1 flex shrink-0 items-center gap-0.5">
        {timeAgo && <span className="font-mono text-[10px] text-ink/40" title={timeTitle ?? undefined}>{timeAgo}</span>}
        {trigger}
      </span>
    );
  }

  return (
    // The box is as wide as the age, never a fixed 32px: `12 Sep` is 36px at
    // 10px mono, and a fixed box wrapped it into two lines (`12` / `Sep`).
    // `min-w-8` keeps the 22px trigger's box inside the column, and the age
    // stays in flow so the title truncates before it instead of under it.
    <span className="relative ml-2 flex h-4 min-w-8 shrink-0 items-center justify-end pr-1">
      {timeAgo && (
        <span
          className="whitespace-nowrap font-mono text-[10px] leading-none text-ink/40 transition-opacity group-hover/item:opacity-0 group-focus-within/item:opacity-0"
          title={timeTitle ?? undefined}
        >
          {timeAgo}
        </span>
      )}
      {/* `-my-1`: the glyph's 22px hit area is larger than the row's trailing
          box, and negative margin keeps that height out of the row's own — the
          row is 30px by construction, not 30px plus whatever the trigger needs
          for a comfortable tap. */}
      <span className="absolute right-0 -my-1 flex">{trigger}</span>
    </span>
  );
}
