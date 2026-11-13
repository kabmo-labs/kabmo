/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a popover hangs, as arithmetic.
 *
 * A menu that is placed by CSS alone (`absolute right-0 top-full`) cannot see
 * the edge of the window, so it runs off the bottom of a short window and off
 * the right of a narrow one, and it is placed inside whatever stacking context
 * its trigger happens to live in. Both failure modes were measured on this
 * app's own folder menu and server panel (see `common/anchored-menu/`), which
 * is why the geometry below is computed from the VIEWPORT and then applied to
 * a portalled, `fixed` panel.
 *
 * Pure and viewport-injected (no `window` read) so a test can assert the flip
 * and the clamp without a layout engine.
 */

/** The trigger's rectangle in viewport coordinates. */
export interface AnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Which edge of the trigger the menu aligns to.
 *
 * `end` hangs the menu's right edge off the trigger's — what a trailing `⋯`
 * expects. `start` puts the menu's left edge at the trigger's.
 */
export type MenuAlign = 'start' | 'end';

export interface MenuPlacement {
  top: number;
  left: number;
  /** The panel must scroll rather than run past the bottom edge. */
  maxHeight: number;
}

/** Room kept between a menu and the window's edges. */
const MARGIN = 8;

/** Room between the trigger and the menu that hangs off it. */
const GAP = 4;

/**
 * The smallest slice of space below a trigger that is still worth hanging a
 * menu into.
 *
 * A menu that does not fit is SCROLLABLE (`maxHeight`), so "does not fit" is not
 * a reason to flip. Flipping is what a phone does to every row in the lower half
 * of its drawer — its action menu is ~300px tall and the space below a row near
 * the bottom is smaller than that even though it can show several rows — so the
 * menu opened ABOVE the button the user just pressed. Below is where a menu is
 * expected; only when the strip below is too short to show two rows is above
 * the better answer.
 */
const MIN_BELOW = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Place a menu of `size` against `anchor`, inside `viewport`.
 *
 * Below the trigger first, because that is where a menu is expected. When its
 * natural size does not fit below, it still hangs below and `maxHeight` makes it
 * scroll, as long as at least `MIN_BELOW` pixels remain; only a trigger that
 * close to the bottom edge flips the menu above. When neither side fits, it
 * pins to the top margin and scrolls — a menu taller than the window is
 * readable, one pushed past the bottom edge is not.
 */
export function placeMenu(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: MenuAlign = 'end',
): MenuPlacement {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP;
  const belowSpace = viewport.height - below - MARGIN;

  let top: number;
  if (below + size.height + MARGIN <= viewport.height) top = below;
  else if (belowSpace >= MIN_BELOW) top = below;
  else if (above - size.height >= MARGIN) top = above - size.height;
  else top = MARGIN;

  const widest = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  const left = align === 'end'
    ? clamp(anchor.right - size.width, MARGIN, widest)
    : clamp(anchor.left, MARGIN, widest);

  return { top, left, maxHeight: Math.max(MARGIN, viewport.height - top - MARGIN) };
}

/** The trigger's rect, as the anchor type above. */
export function anchorRectOf(element: Element): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
}
