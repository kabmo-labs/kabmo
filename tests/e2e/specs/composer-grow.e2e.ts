/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The docked composer grows with its draft, to seven lines, then scrolls.
 *
 * Both halves are invisible to a unit test of the class list: whether the box
 * actually grows is a measurement (`scrollHeight` against an inline height that
 * a `min-h-*` class floors), and whether it STOPS is a measurement against the
 * textarea's own line box — the ceiling is a line count precisely because iOS
 * renders this same element at 16px, so a px cap would be a different number of
 * lines there.
 *
 * The shrink-back is the third fact, and the one that regressed first when this
 * was written: measuring `scrollHeight` without collapsing the box to `auto`
 * first reports the box's own height, so deleting text could never bring the
 * composer back down.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

/** The docked textarea's rendered box plus the numbers its ceiling is made of. */
function textareaBox(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector('[data-testid="composer-input"]') as HTMLTextAreaElement | null;
    if (!input) return null;
    const style = getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const fontSize = Number.parseFloat(style.fontSize);
    return {
      height: Math.round(input.getBoundingClientRect().height),
      clientHeight: input.clientHeight,
      scrollHeight: input.scrollHeight,
      overflowY: style.overflowY,
      line: Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.5,
      padding: (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0),
    };
  });
}

const LINES = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

test.describe('composer growth', () => {
  test('grows to seven lines and scrolls past them', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-composer-grow');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();

    const docked = await textareaBox(page);
    expect(docked).not.toBeNull();

    // Three lines: the box has grown off its docked floor.
    await input.fill(LINES(3));
    await expect.poll(async () => (await textareaBox(page))!.height).toBeGreaterThan(docked!.height);

    const threeLines = (await textareaBox(page))!;
    const ceiling = Math.ceil(7 * threeLines.line + threeLines.padding);
    expect(threeLines.height).toBeLessThan(ceiling);

    // Well past the ceiling: the box stops at seven lines and scrolls inside.
    await input.fill(LINES(40));
    await expect.poll(async () => (await textareaBox(page))!.overflowY).toBe('auto');

    const capped = (await textareaBox(page))!;
    expect(capped.height).toBeLessThanOrEqual(ceiling + 1);
    expect(capped.height).toBeGreaterThan(threeLines.height);
    // Content really is past the box — the ceiling is a scroll, not a clip.
    expect(capped.scrollHeight).toBeGreaterThan(capped.clientHeight);

    // Deleting the draft brings the composer back to its docked size.
    await input.fill('one line');
    await expect.poll(async () => (await textareaBox(page))!.height).toBe(docked!.height);
    const shrunk = (await textareaBox(page))!;
    expect(shrunk.overflowY).toBe('hidden');

    workspace.dispose();
  });
});
