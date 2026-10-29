/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's width mode, resolved by a real browser.
 *
 * This spec exists because the one thing that can break the feature is
 * invisible to a unit test: the mode is a CSS VARIABLE overridden by an
 * attribute selector, and `[data-chat-width]` ties with `:root` on specificity
 * (0,1,0) — so a stylesheet where the override wins or loses on source order
 * looks perfect in the module and renders the default width for every mode. The
 * `width-mode` unit tests assert the attribute the writer produces; only a
 * browser resolves which declaration wins.
 *
 * The second fact pinned here is that the transcript and the COMPOSER share one
 * column. `full` used to be specified with the composer held at the default
 * width (borrowed from openchamber, where the toggle is not called "full"), and
 * a mode that says full while the input stops at 970 is the silent substitution
 * the shell rules forbid.
 *
 * Every read is POLLED: a column is a flex child beside animating panels, so a
 * single read straight after a click catches it mid-transition.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import type { Page } from '@playwright/test';

/** Every `.chat-column` on screen, in px, plus the variable that drives them. */
function columns(page: Page) {
  return page.evaluate(() => ({
    max: getComputedStyle(document.documentElement).getPropertyValue('--chat-column-max').trim(),
    widths: [...document.querySelectorAll('.chat-column')].map((column) => Math.round(column.getBoundingClientRect().width)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
}

async function openChat(page: Page, baseURL: string, folderId: number, folderName: string) {
  await openApp(page, `${baseURL}/?folderId=${folderId}`);
  await expect(page.getByText(folderName).first()).toBeVisible();
  const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
  await expect(input).toBeVisible();
  await input.fill('width probe');
  await input.press('Enter');
  // The composer dock and the transcript are both columns once the chat opens.
  await expect.poll(async () => (await columns(page)).widths.length).toBeGreaterThanOrEqual(2);
}

test.describe('chat width modes', () => {
  test('each mode sets one width, and transcript and composer agree', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-chat-width');
    // Wide enough that all three modes differ from each other.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openChat(page, server.baseURL, workspace.id, 'e2e-chat-width');

    for (const [mode, expected] of [['compact', 720], ['wide', 970]] as const) {
      await page.evaluate((value) => document.documentElement.setAttribute('data-chat-width', value), mode);
      await expect.poll(async () => (await columns(page)).widths).toEqual([expected, expected]);
      expect((await columns(page)).overflow).toBe(0);
    }

    // `full` is the panel, not a constant: it must be wider than `wide` and it
    // must NOT overflow the page.
    await page.evaluate(() => document.documentElement.setAttribute('data-chat-width', 'full'));
    await expect.poll(async () => (await columns(page)).max).toBe('100%');
    const full = await columns(page);
    expect(new Set(full.widths).size).toBe(1);
    expect(full.widths[0]).toBeGreaterThan(970);
    expect(full.overflow).toBe(0);

    // A stored value this build cannot draw lands on the default column.
    await page.evaluate(() => document.documentElement.setAttribute('data-chat-width', 'gigantic'));
    await expect.poll(async () => (await columns(page)).widths).toEqual([970, 970]);
  });

  test('the settings control applies and persists the choice', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-chat-width-settings');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openChat(page, server.baseURL, workspace.id, 'e2e-chat-width-settings');

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('omp:open-settings', { detail: { category: 'chats' } })));
    await expect(page.getByText('Chat Width', { exact: true })).toBeVisible();
    await page.getByText('Compact', { exact: true }).click();

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-chat-width')))
      .toBe('compact');

    // Through the REAL writer: a click that only moved the attribute would
    // look right until the next reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('e2e-chat-width-settings').first()).toBeVisible();
    await expect.poll(async () => (await columns(page)).widths.every((width) => width === 720)).toBe(true);
  });
});
