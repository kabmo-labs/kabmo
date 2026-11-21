/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One icon control in the phone editor's title bar.
 *
 * The bar drew its own buttons, each with `p-1.5` and no plate, so every control
 * measured **27x27** — under the 36px phone-chrome box the rest of the app uses,
 * and 17px under the 44px touch floor — because nine of them had to share a
 * 390px row. It also left five of the nine with no accessible name (a `title`
 * only), which makes them unreachable to a screen reader.
 *
 * So the box, the glyph and the name are one component, and the bar folds what
 * does not fit into an overflow menu rather than shrinking it (the same answer
 * `header-controls/MoreMenu` and `ToolbarOverflowMenu` reached): a control that
 * is a thumb-width wide is worth more than a control that is always visible and
 * never hittable.
 */

import type { ReactNode } from 'preact/compat';
import { CONTROL_BOX, CONTROL_GLYPH_PX } from '@/client/lib/ui/control-plate';

interface EditorActionProps {
  /** Accessible name AND tooltip — one string, so they cannot disagree. */
  label: string;
  onClick: () => void;
  /** Draws the pressed state (an open find bar, an active preview). */
  active?: boolean;
  /** A destructive/urgent action, filled in the error colour. */
  danger?: boolean;
  children: ReactNode;
}

export function EditorAction({ label, onClick, active = false, danger = false, children }: EditorActionProps) {
  const tone = danger
    ? 'bg-error text-canvas hover:bg-error/90'
    : active
      ? 'bg-ink text-canvas'
      : 'text-ink/70 hover:bg-ink/10 hover:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={`${CONTROL_BOX.mobile} flex-none cursor-pointer rounded-lg transition-colors ${tone}`}
    >
      {children}
    </button>
  );
}

/** The glyph size every control in this bar draws. */
export const EDITOR_ACTION_GLYPH_PX = CONTROL_GLYPH_PX.mobile;
