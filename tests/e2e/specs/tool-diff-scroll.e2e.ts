/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A long `edit` card scrolls its diff, in both shapes.
 *
 * The bug this pins is invisible to every other layer. The card's diff host is
 * bounded by `max-h-72` (288px) and the CodeMirror root inside it carries
 * `height: 100%` — a percentage, which resolves against a DEFINITE containing
 * block. A `max-height` ancestor is indefinite for that purpose, so the root
 * computed to `auto` and grew to its content: measured on a real transcript, a
 * 1847px editor inside a 288px host, clipped by `overflow-hidden` with
 * `scrollHeight === clientHeight`. A 30-line edit card therefore showed nine
 * rows and the rest was unreachable — in BOTH shapes (unified 1847px, split
 * 1928px).
 *
 * A happy-dom mount cannot see this (it computes no layout), and the CSS gate
 * only proves the rule reaches the bundle. The claim here is the rendered
 * geometry of a real browser: the root fills the host, the editor's own
 * scroller owns the overflow, and a scroll actually moves.
 *
 * The patch is omp's EXCERPT dialect (` 41|text`), because that is what
 * `details.diff` holds — `DiffView` converts it before the merge view sees it.
 */

import { test, expect } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import { openApp } from '../fixtures/app';

/** Removed/added PAIRS. Every row is a change, so `contentMode: 'diff'`
 *  cannot collapse them away and the card must scroll. */
const PATCH_PAIRS = 40;

test.describe('a tool diff scrolls inside its card', () => {
  test('the diff card fills its ceiling and scrolls its own rows', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-diff-scroll');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    // The folder name is the gate the send path needs: `send.ts` resolves the
    // spawn cwd from the sidebar list, which loads asynchronously.
    await expect(page.getByText('e2e-diff-scroll').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill(`edit:${PATCH_PAIRS} then answer`);
    await input.press('Enter');

    const card = page.getByRole('button', { name: /^Expand Edit/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();

    const scroller = page.getByTestId(TESTID.diffScroller).first();
    await expect(scroller).toBeVisible({ timeout: 15_000 });

    // The failure mode is a scroller that is as tall as the document, so the
    // assertion is the RANGE, not "an element exists".
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 10_000 })
      .toBeGreaterThan(200);

    // The root fills the host: a percentage height against the `max-height`
    // wrapper used to leave this at the document's own height.
    const geometry = await scroller.evaluate((el) => {
      const host = el.closest('[data-code-surface]') as HTMLElement | null;
      const root = host?.firstElementChild as HTMLElement | null;
      return {
        host: host ? Math.round(host.getBoundingClientRect().height) : 0,
        root: root ? Math.round(root.getBoundingClientRect().height) : 0,
      };
    });
    expect(geometry.host).toBeGreaterThan(0);
    expect(geometry.host).toBeLessThanOrEqual(300);
    expect(geometry.root).toBe(geometry.host);

    // And it actually moves — a scroll container that is sized but inert
    // (pointer-events, an overlay above it) fails here.
    const moved = await scroller.evaluate((el) => {
      el.scrollTop = 400;
      return el.scrollTop;
    });
    expect(moved).toBeGreaterThan(300);

    workspace.dispose();
  });

  test('the split shape scrolls too, and keeps its range when switched back', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-diff-scroll-split');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-diff-scroll-split').first()).toBeVisible();
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill(`edit:${PATCH_PAIRS} then answer`);
    await input.press('Enter');

    const card = page.getByRole('button', { name: /^Expand Edit/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();

    const scroller = page.getByTestId(TESTID.diffScroller).first();
    await expect(scroller).toBeVisible({ timeout: 15_000 });

    // Split is a different root (`.cm-mergeView`, not `.cm-editor`), so it is
    // a separate case: the rule names both, and one of them was missed.
    await page.getByRole('button', { name: 'Split view' }).first().click();

    /** Host, root and range in one read, so a poll cannot mix two renders. */
    const shape = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="diff-scroller"]') as HTMLElement | null;
        const host = el?.closest('[data-code-surface]') as HTMLElement | null;
        const root = host?.firstElementChild as HTMLElement | null;
        return {
          rootClass: root?.className ?? '',
          host: host ? Math.round(host.getBoundingClientRect().height) : 0,
          root: root ? Math.round(root.getBoundingClientRect().height) : 0,
          range: el ? el.scrollHeight - el.clientHeight : 0,
        };
      });

    // The SHAPE is what the switch changes, and the effect that mounts the
    // other view runs after the click's render — so waiting on the range alone
    // measured the unified view still in place (it has range too) and read the
    // OLD root.
    await expect
      .poll(async () => (await shape()).rootClass, { timeout: 15_000 })
      .toContain('cm-mergeView');

    await expect.poll(async () => (await shape()).range, { timeout: 10_000 }).toBeGreaterThan(200);

    const split = await shape();
    expect(split.root).toBe(split.host);
    expect(split.host).toBeGreaterThan(0);
    expect(split.host).toBeLessThanOrEqual(300);

    await page.getByRole('button', { name: 'Unified view' }).first().click();
    await expect
      .poll(async () => (await shape()).rootClass, { timeout: 15_000 })
      .not.toContain('cm-mergeView');
    await expect.poll(async () => (await shape()).range, { timeout: 10_000 }).toBeGreaterThan(200);

    workspace.dispose();
  });
});
