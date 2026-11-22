/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's two rows share ONE left gutter.
 *
 * The paperclip in the attachment row and the harness mark at the start of the
 * model chip below it are the card's only two left-hand marks, so they read as
 * a column. They did not: the attach button carried `p-1` while the chip
 * carried `px-2`, and the paperclip's own path starts 1.75px inside its box —
 * measured at 1400x900 on a 684px card, ink began at 18.75px against the
 * harness mark's 21.6px, a 3px staircase that grows with every row added.
 *
 * A unit test cannot see this: happy-dom does no layout, so the assertion would
 * be on a class string rather than on the column the reader sees. Both facts
 * here are measurements — the ink column, and each glyph's inset from its own
 * control's leading edge, which is what keeps the column on a touch screen
 * where `.tap-target` widens the button to 44px.
 */

import { devices, type Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

interface Gutter {
  /** Painted left edge of the paperclip, in px from the card's left edge. */
  paperclip: number;
  /** Painted left edge of the harness mark, same origin. */
  harness: number;
  /** How far each glyph sits inside its own control's leading edge. */
  paperclipInset: number;
  harnessInset: number;
}

/**
 * Measure the gutter.
 *
 * "Painted left edge" is the SVG's box corrected by its own `viewBox` and the
 * path's bounding box: a 14px lucide icon centres a 12.5px drawing, and the
 * harness mark crops its viewBox to the path. Comparing raw element boxes would
 * have reported the two marks as aligned when their ink was not.
 */
function measureGutter(page: Page): Promise<Gutter | null> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-composer-style]');
    const paperclip = card?.querySelector('.composer-attach-row button svg');
    // `data-harness` also sits on the glyph's WRAPPER span; `data-harness-id`
    // is only on the `<svg>`, which is the element that has a viewBox.
    const harness = card?.querySelector('.composer-toolbar-row svg[data-harness-id]');
    if (!card || !paperclip || !harness) return null;

    const origin = card.getBoundingClientRect().x;
    const inkLeft = (svg: SVGSVGElement) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const box = svg.getBBox();
      const scale = rect.width / (viewBox.width || rect.width);
      return rect.x - origin + (box.x - viewBox.x) * scale;
    };
    const controlLeft = (svg: SVGSVGElement) => (svg.closest('button') as HTMLElement).getBoundingClientRect().x - origin;

    return {
      paperclip: inkLeft(paperclip as SVGSVGElement),
      harness: inkLeft(harness as SVGSVGElement),
      paperclipInset: inkLeft(paperclip as SVGSVGElement) - controlLeft(paperclip as SVGSVGElement),
      harnessInset: inkLeft(harness as SVGSVGElement) - controlLeft(harness as SVGSVGElement),
    };
  });
}

/** Both facts, asserted together so a failure names the row that moved. */
function expectOneColumn(gutter: Gutter | null) {
  expect(gutter).not.toBeNull();
  const measured = gutter as Gutter;
  // The staircase: the two marks must paint at the same x, within the
  // sub-pixel rounding of two different icon sets.
  expect(Math.abs(measured.paperclip - measured.harness)).toBeLessThanOrEqual(1);
  // The column has to survive the touch floor: the glyph stays at its control's
  // leading inset instead of floating to the middle of a widened hit area.
  expect(Math.abs(measured.paperclipInset - measured.harnessInset)).toBeLessThanOrEqual(1);
}

test.describe('composer gutter', () => {
  test('the paperclip and the harness mark share one column', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-composer-gutter');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.locator(`[data-testid="${TESTID.composerInput}"]`)).toBeVisible();

    expectOneColumn(await measureGutter(page));
  });

  test('the column holds on a touch screen, where the hit area widens', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-composer-gutter-touch');

    // A real device context, not a narrow viewport: `.tap-target`'s 44px floor
    // is behind `(pointer: coarse)`, which only a device emulation reports.
    const browser = page.context().browser();
    expect(browser).not.toBeNull();
    const phone = await browser!.newContext({ ...devices['Pixel 7'] });
    try {
      const touch = await phone.newPage();
      await openApp(touch, `${server.baseURL}/?folderId=${workspace.id}`);
      await expect(touch.locator(`[data-testid="${TESTID.composerInput}"]`)).toBeVisible();

      const gutter = await measureGutter(touch);
      expectOneColumn(gutter);
      // The floor is real here, so the widening is the thing being survived.
      const width = await touch.evaluate(() => {
        const button = document.querySelector('.composer-attach-row button');
        return button ? Math.round(button.getBoundingClientRect().width) : 0;
      });
      expect(width).toBeGreaterThanOrEqual(44);
    } finally {
      await phone.close();
    }
  });
});
