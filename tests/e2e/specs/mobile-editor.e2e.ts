/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's full-screen editor, on the same surface as the desktop one.
 *
 * This is the mobile half of the CodeMirror cutover: the surface is one
 * component on both layouts, and the phone is where it is easiest to get wrong —
 * the editor is a fixed overlay, its box is the whole screen, and a scroller
 * nested inside it has nothing to scroll. It also has the only other caller of
 * the scroll-restore hook, keyed by PATH rather than by tab id.
 *
 * What is asserted is what a phone user would notice: the file's text is on
 * screen, typing into it reaches the buffer, the write lands on disk (the phone
 * autosaves — it has no Save button except the one that recreates a deleted
 * file), closing then reopening the same file comes back to the same place, and
 * the outline sheet is a TABLE OF CONTENTS while a markdown page is rendered —
 * a tap scrolls the page and the reader stays in the preview instead of being
 * thrown back to the source.
 *
 * A real device run (soft keyboard, IME composition, selection handles) is the
 * one thing this cannot cover: a desktop browser has no soft keyboard, and
 * Playwright's mobile emulation is a viewport, not an input method.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** Long enough to scroll; short enough to render fast. */
const LINES = 200;

test.describe('mobile editor', () => {
  test('opens a file in the full-screen editor and saves an edit', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-editor');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'notes.txt');
    writeFileSync(filePath, 'first line\nsecond line\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // The Files drawer is a screen on the phone; the tree's first read is what
    // the tap needs, so the row is awaited rather than the drawer.
    await page.getByRole('button', { name: /panel|files/i }).first().click();
    const row = page.getByText('notes.txt', { exact: true }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByText('src', { exact: true }).first().click();
    }
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // CodeMirror, not a textarea: the surface renders `.cm-content`.
    const content = page.locator('.cm-content').first();
    await expect(content).toContainText('first line', { timeout: 15_000 });

    await content.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('third line');

    // The phone autosaves on a debounce, so the write's response is the gate —
    // there is no Save control to press on this layout.
    await page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/fs'),
      { timeout: 20_000 },
    );
    await expect
      .poll(() => readFileSync(filePath, 'utf8'), { timeout: 15_000 })
      .toContain('third line');

    workspace.dispose();
  });

  test('remembers the scroll position of the file it reopens', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-editor-scroll');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'long.txt'), Array.from({ length: LINES }, (_, i) => `line ${i + 1}`).join('\n'));

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: /panel|files/i }).first().click();
    const row = page.getByText('long.txt', { exact: true }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByText('src', { exact: true }).first().click();
    }
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const scroller = page.locator('[data-testid="editor-scroller"]').first();
    await expect(scroller).toBeVisible({ timeout: 15_000 });
    // Every write of the session's UI state, from before the scroll: the
    // debounced save can land either before or after the poll below returns,
    // and `waitForResponse` attaches too late for the first case.
    const stateWrites: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (!new URL(request.url()).pathname.endsWith('/state')) return;
      stateWrites.push(request.postData() ?? '');
    });
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(500);

    // The scroller's restore REPLAYS for ~600ms after the document opens — the
    // file's height is still settling, so the hook re-applies the remembered
    // offset (0 here) on every resize. A single assignment inside that window is
    // undone by the next replay: measured, `scrollTop` read back as 0 and the
    // spec failed with "Expected: > 500, Received: 0" on one run in ten. Polling
    // the assignment makes the gate the CONDITION (the replay has stopped and
    // the write stuck), not a duration.
    await expect
      .poll(
        async () =>
          scroller.evaluate((el) => {
            // The input a reader's scroll starts with — see `diff-panel.e2e.ts`.
            el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }));
            el.scrollTop = 800;
            el.dispatchEvent(new Event('scroll'));
            return el.scrollTop;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(500);
    const leftAt = await scroller.evaluate((el) => el.scrollTop);

    // The write is debounced, so the SAVE is the gate rather than a duration —
    // and it must be the write carrying THIS offset. A save queued during the
    // restore replay (which applies the remembered 0) can land in between:
    // measured, the reopen then restored 0 and the spec failed one run in ten.
    await expect
      .poll(() => stateWrites.some((body) => body.includes(String(leftAt))), { timeout: 15_000 })
      .toBe(true);

    // Close the overlay by its OWN control. A loose `/close/` matches the
    // drawer's "Close right sidebar" behind the overlay, whose click the overlay
    // intercepts — the failure names a download icon, not a close button.
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await row.click();
    await expect
      .poll(async () => page.locator('[data-testid="editor-scroller"]').first().evaluate((el) => el.scrollTop), {
        timeout: 15_000,
      })
      .toBe(leftAt);

    workspace.dispose();
  });

  test('the outline sheet is a table of contents on a rendered markdown page', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-outline');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'notes.md'),
      [
        '# Title',
        '',
        ...Array.from({ length: 40 }, (_, i) => `Intro paragraph ${i}.`),
        '',
        '## First Section',
        '',
        ...Array.from({ length: 40 }, (_, i) => `First body ${i}.`),
        '',
        '## Second Section',
        '',
        'More.',
      ].join('\n'),
    );

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: /panel|files/i }).first().click();
    const row = page.getByText('notes.md', { exact: true }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByText('src', { exact: true }).first().click();
    }
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // A markdown file opens RENDERED on this layout too, which is what makes the
    // sheet a contents list rather than a symbol list.
    const preview = page.locator('.prose-content').first();
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const scroller = page.locator('[data-testid="editor-scroller"]').first();
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(200);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);

    await page.getByRole('button', { name: /^Outline \(/ }).click();
    // No line numbers: a rendered document has none to name.
    const tocRow = page.getByRole('button', { name: 'Heading Second Section', exact: true });
    await expect(tocRow).toBeVisible();
    await tocRow.click();

    // The page scrolled and the reader is STILL in the preview.
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator('.prose-content').first()).toBeVisible();

    workspace.dispose();
  });
});
