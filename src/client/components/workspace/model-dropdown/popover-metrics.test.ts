/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picker's SIZE contract, as arithmetic rather than a screenshot.
 *
 * Three measured failures are pinned here, each found in a real browser:
 *
 *  - a `w-84 sm:w-96` constant (336/384px) put a 384px popover inside a 320px
 *    chat panel, hanging 64px past the composer's edge — and wider than a 390px
 *    phone screen;
 *  - a `max-h-[460px]` constant put the harness tab strip at y=22 under a 40px
 *    titlebar, so `elementFromPoint` on the first tab answered `HEADER`: the
 *    control was in the DOM and unreachable by pointer;
 *  - budgeting the width from the PANEL's width let a 437px card hang 29px past a
 *    421px composer, because the card starts at the TRIGGER (13px inside the
 *    panel) and that overhang is space it cannot use.
 *
 * The height then went to 620 and came back to 460: a card that tall reads as a
 * panel over the conversation rather than a menu beside the composer.
 *
 * The arithmetic lives in `popover-metrics.ts` so the rule can be asserted
 * without a layout engine; the component only applies it.
 */

import { describe, expect, test } from 'bun:test';
import { popoverMetrics } from '@/client/components/workspace/model-dropdown/popover-metrics';

/** A roomy desktop: the trigger starts at the composer's left padding. */
const DESKTOP = {
  triggerTop: 700,
  anchorLeft: 328,
  containerRight: 1000,
  viewportWidth: 1440,
  viewportTop: 0,
};

describe('popover metrics: width', () => {
  test('capped at 512 on a wide desktop so the list does not sprawl', () => {
    expect(popoverMetrics(DESKTOP).width).toBe(512);
  });

  test('never past the composer it belongs to', () => {
    // A 421px panel whose trigger starts 13px inside it: the card may use
    // 421 - 13 - 8 = 400px, not the panel's full width. The previous form used
    // the width, produced 437, and hung 29px past the edge.
    const { width } = popoverMetrics({
      triggerTop: 700, anchorLeft: 328, containerRight: 736, viewportWidth: 1024, viewportTop: 0,
    });
    expect(width).toBe(400);
    expect(328 + width).toBeLessThanOrEqual(736 - 8 + 1);
  });

  test('a shrink-wrapped trigger does not shrink the card', () => {
    // The budget names the PANEL edge, never the chip's own box: a 98px chip
    // inside a 712px composer still gets the full cap.
    const wide = popoverMetrics({ triggerTop: 700, anchorLeft: 328, containerRight: 1040, viewportWidth: 1440, viewportTop: 0 });
    expect(wide.width).toBe(512);
  });

  test('narrower than the screen on a phone', () => {
    const { width } = popoverMetrics({
      triggerTop: 600, anchorLeft: 12, containerRight: 378, viewportWidth: 390, viewportTop: 0,
    });
    expect(width).toBeLessThanOrEqual(390 - 12 - 8);
    expect(width).toBeGreaterThanOrEqual(240);
  });

  test('the viewport wins over a container wider than the screen', () => {
    // A zoomed phone can report a container wider than the visible area.
    const { width } = popoverMetrics({
      triggerTop: 600, anchorLeft: 20, containerRight: 2000, viewportWidth: 390, viewportTop: 0,
    });
    expect(width).toBe(362);
  });
});

describe('popover metrics: height', () => {
  test('clears the titlebar: the card never starts under the chrome', () => {
    // A trigger 100px from the top on a short window is the case that broke: a
    // 180px floor pushed the card's top edge under the 40px titlebar and made
    // its first row unclickable. The viewport wins.
    const { height } = popoverMetrics({ ...DESKTOP, triggerTop: 100 });
    expect(height).toBe(100 - 48);
  });

  test('uses the room above the trigger when it is below the cap', () => {
    // 300 - 48 = 252 available, so the whole band is used.
    const { height } = popoverMetrics({ ...DESKTOP, triggerTop: 300 });
    expect(height).toBe(252);
  });

  test('the cap is 460 and it is a cap, not a size', () => {
    expect(popoverMetrics({ ...DESKTOP, triggerTop: 1200 }).height).toBe(460);
    // A short window still wins: 400 - 48 = 352.
    expect(popoverMetrics({ ...DESKTOP, triggerTop: 400 }).height).toBe(352);
  });

  test('the phone keyboard shrinks the budget instead of hiding the card', () => {
    const phone = { triggerTop: 700, anchorLeft: 12, containerRight: 378, viewportWidth: 390 };
    const open = popoverMetrics({ ...phone, viewportTop: 0 });
    const keyboarded = popoverMetrics({ ...phone, viewportTop: 260 });
    expect(keyboarded.height).toBeLessThan(open.height);
  });
});
