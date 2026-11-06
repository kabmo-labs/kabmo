/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How big the model picker may be.
 *
 * Pure arithmetic, in its own module, because the rule is a CONSTRAINT rather
 * than a style: the popover hangs upward from a trigger inside the composer, so
 * its height is bounded by the space above that trigger and its width by the
 * space to the right of that trigger. Expressing either as a constant failed in a
 * real browser (a 384px card in a 320px panel; a 460px card whose top row sat
 * under the 40px titlebar and could not be clicked). A pure function lets both be
 * asserted.
 *
 * Both limits are measured from the ANCHOR — the trigger's left edge, which is
 * where the card starts. Measuring the panel's WIDTH instead let a 437px card
 * hang 29px past a 421px composer: the trigger sits 13px inside the panel (its
 * padding and the toolbar rails before it), and that overhang is space the card
 * cannot use. Measured at 1024x700.
 */

/** Window chrome the popover must clear: the 40px titlebar plus 8px of air. */
export const CHROME_RESERVE = 48;

/** Air kept between the card's right edge and the panel/viewport edge. */
const GUTTER = 8;

/**
 * Widest the picker ever gets, on a roomy desktop.
 *
 * 512, up from 384: at 384 a model row cut its own name. The row carries two
 * marks, the model name, a context figure, a thinking chip and a favourite star,
 * and `Agnes-2-5-Flash - Free` measured `scrollWidth 139 / clientWidth 0` once
 * the trailing plates took their share.
 */
const MAX_WIDTH = 512;
/** Narrowest it is allowed to get before it stops being usable. */
const MIN_WIDTH = 240;
/**
 * Tallest it ever gets, on a roomy desktop.
 *
 * Back to 460 after trying 620: at 620 the card stood ~14 rows tall on a
 * 1200px-tall window and read as a panel covering the conversation, not a menu
 * over it. Only the WIDTH was the reported problem, and 512 is what fixed it —
 * a taller card was not a request. Still a CAP, never a size: on a short window
 * `roomAbove` wins and the card shrinks.
 */
const MAX_HEIGHT = 460;
/**
 * Preferred height, honoured only while the space above the trigger allows it.
 *
 * A hard floor is what put the card under the titlebar: with 52px of room, a
 * 180px minimum pushed the top edge behind the chrome and made the first row
 * unclickable. A short card with an internally scrolling list is worse-looking
 * and always usable, so the viewport wins.
 */
const MIN_HEIGHT = 180;

export interface PopoverInput {
  /** Top edge of the trigger, in viewport coordinates. */
  triggerTop: number;
  /**
   * Left edge of the trigger, in viewport coordinates — the card's anchor, and
   * the only sane origin for a card that grows rightward from it.
   */
  anchorLeft: number;
  /**
   * Right edge of the composer CARD the trigger sits in, in viewport
   * coordinates.
   *
   * The PANEL, not the trigger: the trigger is a chip that shrink-wraps its
   * label (measured 259px inside a 712px composer), so budgeting from it capped
   * the card at 275px and truncated every model name. And not the panel's WIDTH
   * either, which is what the previous form took — a width says nothing about
   * how much of it is to the RIGHT of the anchor.
   */
  containerRight: number;
  /** Visible viewport width (`visualViewport.width` on a phone). */
  viewportWidth: number;
  /** Visible viewport offset, non-zero while a phone keyboard is up. */
  viewportTop: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

/**
 * The size to give the popover.
 *
 * Width: the space from the anchor to the nearer of the composer's right edge
 * and the viewport's, less the gutter; floored at `MIN_WIDTH` and capped at
 * `MAX_WIDTH`.
 *
 * Height: the space between the trigger and the chrome above it, capped at
 * `MAX_HEIGHT`, floored at `MIN_HEIGHT`.
 */
export function popoverMetrics({
  triggerTop,
  anchorLeft,
  containerRight,
  viewportWidth,
  viewportTop,
}: PopoverInput): PopoverSize {
  const roomLeft = Math.min(containerRight, viewportWidth) - anchorLeft - GUTTER;
  const roomAbove = triggerTop - viewportTop - CHROME_RESERVE;
  return {
    width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, roomLeft)),
    // `MIN_HEIGHT` is a PREFERENCE, not a clamp, for the reason stated on it.
    height: roomAbove >= MIN_HEIGHT ? Math.min(MAX_HEIGHT, roomAbove) : Math.max(0, roomAbove),
  };
}
