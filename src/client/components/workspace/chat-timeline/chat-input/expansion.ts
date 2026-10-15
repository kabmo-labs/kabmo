/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's stretched layout — what "bigger" means on each layout.
 *
 * One control, two answers, and the difference is the LAYOUT, not a size:
 *
 *  - **Mobile** takes the whole viewport. The chat is a single column there and
 *    the composer already owns the bottom of it, so stretching it can only
 *    cover the transcript — and that is the point: a phone keyboard plus a
 *    docked 68px box is a four-line window onto a prompt that is often longer.
 *    The card is `fixed inset-0` at `z-40`, which keeps every dialog ABOVE it
 *    (extension/ask `z-50`, goal and undo modals `z-[60]`, plan review
 *    `z-[70]`, toasts `z-[200]`) — a stretched composer that covered a blocking
 *    dialog would make the agent's question unanswerable.
 *  - **Desktop** grows IN PLACE. The chat panel is a column beside the editor
 *    and the right panel, so a full-screen composer would hide the conversation
 *    the prompt is being written against. The textarea grows to a share of the
 *    viewport and the card keeps the width its dock already gives it (which is
 *    the panel's own width, up to the dock's cap) — proportional, not full
 *    screen.
 *
 * Three smaller decisions ride along, and each is why this is a module rather
 * than a ternary in the component:
 *
 *  - **The popup flips over the draft on mobile.** `ComposerPicker` opens
 *    UPWARD (`bottom-full`) because a docked composer has the whole chat above
 *    it. A full-height composer does not: its top edge is the screen's top, so
 *    an upward popup would be drawn off the viewport with nothing to scroll
 *    back. Over the top of the draft is the only placement with room.
 *  - **The keyboard lift beats the home indicator.** Mobile browsers do not
 *    shrink the layout viewport for the soft keyboard, so a bottom-anchored
 *    card keeps its bottom edge under the keys — including the toolbar and the
 *    Send button, and a phone has no hardware Enter to fall back on. The lift
 *    is the panel's own overlap with the visible area (`useKeyboardInset`),
 *    applied as padding; with no keyboard the padding is the home indicator's
 *    inset instead.
 *  - **A send collapses the mobile stretch.** The stretched composer covers the
 *    transcript, so staying stretched would hide the answer being streamed. On
 *    desktop it stays: the chat is visible either way, and a composer that
 *    snapped back on every send would move the box the user is typing in.
 */

import type { CSSProperties } from 'preact';
import type { ComposerPickerPlacement } from '@/client/components/common/ComposerPicker';

export type ComposerVariant = 'desktop' | 'mobile';

export interface ComposerExpansionInput {
  variant: ComposerVariant;
  expanded: boolean;
  /** Whether a file drag currently hovers the composer (the frame's border). */
  isDragging: boolean;
  /**
   * The soft keyboard's overlap with the viewport's bottom edge, in px, from
   * `useKeyboardInset`. 0 when there is no keyboard (or no `visualViewport`).
   */
  keyboardInset: number;
}

export interface ComposerExpansion {
  /** Frame classes for the card: border, radius, background, elevation. */
  cardClass: string;
  /**
   * The card's POSITION, and it is a field of its own because Tailwind's
   * position utilities are ordered `static, fixed, absolute, relative, sticky`
   * — so a `relative` left in the base class list WINS over a `fixed` added
   * later, whatever order they are written in. Measured: the phone card stayed
   * in the dock with `position: relative` and the `fixed inset-0` ignored.
   */
  cardPositionClass: string;
  /** Classes ADDED to the card's own layout (`@container flex …`). */
  cardLayoutClass: string;
  /** The textarea's size classes for this state. */
  textareaClass: string;
  /** Classes for the textarea's WRAPPER — the element the popup anchors to. */
  wrapperClass: string;
  pickerPlacement: ComposerPickerPlacement;
  /** Inline style for the card; undefined when there is nothing to apply. */
  style: CSSProperties | undefined;
}

export function composerExpansion({
  variant,
  expanded,
  isDragging,
  keyboardInset,
}: ComposerExpansionInput): ComposerExpansion {
  const mobile = variant === 'mobile';
  const border = isDragging ? 'border-ink/40' : 'border-ink/20 focus-within:border-ink';

  if (!expanded) {
    return {
      cardClass: `border rounded-md bg-paper shadow-sm ${border}`,
      cardPositionClass: 'relative',
      cardLayoutClass: '',
      textareaClass: mobile
        ? 'px-3 py-3 text-base min-h-[68px] max-h-40'
        : 'px-3 py-3 text-sm min-h-[80px]',
      wrapperClass: '',
      pickerPlacement: 'up',
      style: undefined,
    };
  }

  if (mobile) {
    return {
      // `border-0`, not `border-transparent`: the collapsed frame's
      // `focus-within:border-ink` only sets the border COLOUR, so a transparent
      // border would come back as an ink hairline around the screen the moment
      // the textarea takes focus — which is the state this opens in.
      cardClass: 'border-0 rounded-none bg-paper shadow-none',
      cardPositionClass: 'fixed inset-0 z-40',
      cardLayoutClass: '',
      textareaClass: 'h-full px-3 py-3 text-base',
      wrapperClass: 'flex-1 min-h-0',
      pickerPlacement: 'over',
      style: {
        paddingTop: 'env(safe-area-inset-top, 0px)',
        // The keyboard's overlap is measured, so it is exact; the indicator's
        // inset is only a fallback for the no-keyboard state.
        paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : 'env(safe-area-inset-bottom, 0px)',
      },
    };
  }

  return {
    cardClass: `border rounded-md bg-paper shadow-lg ${border}`,
    cardPositionClass: 'relative',
    cardLayoutClass: '',
    // A share of the viewport, not of the panel: the dock sits at the bottom of
    // a column whose height is the window's, so this is the same proportion at
    // any panel width. It is a `min-h`, so the box is exactly this tall until
    // the content scrolls inside it.
    textareaClass: 'px-3 py-3 text-sm min-h-[38vh]',
    wrapperClass: '',
    pickerPlacement: 'up',
    style: undefined,
  };
}
