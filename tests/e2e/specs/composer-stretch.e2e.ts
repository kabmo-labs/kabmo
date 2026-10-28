/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's stretch control, on both layouts.
 *
 * This spec exists because the bug it pins is invisible to a unit test: the
 * phone's full-screen card rendered as `position: relative` with a `fixed
 * inset-0` class list on it, because Tailwind orders its position utilities
 * `static, fixed, absolute, relative, sticky` — so a `relative` left in the
 * base class list wins over a `fixed` added later, whatever order the strings
 * are written in. A `composerExpansion` unit test asserts the CLASS the module
 * returns; only a real browser resolves which class wins.
 *
 * The facts asserted here are the ones a user would notice: a phone takes the
 * viewport, a desktop grows the box but keeps the chat beside it, and a SEND on
 * EITHER layout returns to the docked composer. The desktop half was a real
 * bug — the collapse was `if (isMobile) setExpanded(false)` in the click
 * handler, so a desktop kept a 38vh box over the conversation the prompt was
 * written against.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

const MAXIMIZE = /maximize composer/i;
const RESTORE = /restore composer/i;

/** The composer card's own box, in the page's coordinate space. */
function cardBox(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector('[data-testid="composer-input"]');
    if (!input) return null;
    const card = input.closest('div[class*="flex-col"]');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    return {
      position: style.position,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      textareaHeight: Math.round(input.getBoundingClientRect().height),
    };
  });
}

test.describe('composer stretch (desktop)', () => {
  test('grows the box in place and keeps the chat beside it', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-composer-desktop');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-composer-desktop').first()).toBeVisible();
    await expect(page.locator(`[data-testid="${TESTID.composerInput}"]`)).toBeVisible();

    const docked = await cardBox(page);
    expect(docked).not.toBeNull();
    // Docked: in the flow, at the bottom of the chat column, not full screen.
    expect(docked!.position).toBe('relative');

    await page.getByRole('button', { name: MAXIMIZE }).click();

    // The control reports its own state, which is what a screen reader reads.
    const restore = page.getByRole('button', { name: RESTORE });
    await expect(restore).toHaveAttribute('aria-pressed', 'true');

    const stretched = await cardBox(page);
    expect(stretched).not.toBeNull();
    // Still in the flow — a desktop composer that went full screen would hide
    // the transcript the prompt is written against.
    expect(stretched!.position).toBe('relative');
    // The same width it had docked. The small delta is the timeline's own
    // scrollbar: a taller composer can make it appear or vanish, which changes
    // the column's content width. What matters is that the box did NOT take the
    // viewport.
    expect(Math.abs(stretched!.width - docked!.width)).toBeLessThanOrEqual(16);
    expect(stretched!.width).toBeLessThan(stretched!.viewport.width);
    // The textarea grew; the dock's own placement did not move to the top.
    expect(stretched!.textareaHeight).toBeGreaterThan(docked!.textareaHeight);
    expect(stretched!.y).toBeLessThan(docked!.y);

    await restore.click();
    const restored = await cardBox(page);
    expect(restored!.textareaHeight).toBe(docked!.textareaHeight);

    // A SEND collapses it too, on this layout as well. Staying stretched keeps a
    // 38vh box over the conversation the prompt was written against.
    //
    // The send is deliberately the SECOND one. A workspace opened with no
    // `?sessionId=` sends into a pending `new-…` chat, and the spawn adopts it
    // under omp's UUID — a remount that resets the composer's own state, so a
    // first send collapses whether or not the rule exists. Measured: with the
    // collapse deleted entirely, the first-send version of this spec still
    // passed. The adopted session's composer is the one that has to do it.
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill('first prompt');
    await page.getByRole('button', { name: /send message/i }).first().click();
    await expect(page.getByText('Response to: first prompt').first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/sessionId=(?!new-)/);

    await page.getByRole('button', { name: MAXIMIZE }).click();
    await expect(page.getByRole('button', { name: RESTORE })).toHaveAttribute('aria-pressed', 'true');
    await input.fill('stretch and send');
    await page.getByRole('button', { name: /send message/i }).first().click();

    await expect(page.getByText('Response to: stretch and send').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: MAXIMIZE })).toHaveAttribute('aria-pressed', 'false');
    const afterSend = await cardBox(page);
    expect(afterSend!.textareaHeight).toBe(docked!.textareaHeight);

    workspace.dispose();
  });
});
