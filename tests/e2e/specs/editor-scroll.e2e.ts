/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor remembers where each tab was left scrolled.
 *
 * The bug this pins: the editor column keeps ONE scroll container and swaps the
 * document inside it on a tab switch, so the browser clamped the shared
 * scroller to the height of whatever arrived next — coming back to a long file
 * landed at line 1 and the reader had to find their place again.
 *
 * It is only observable assembled. A unit test can drive the hook with faked
 * geometry, but the failure is a real browser clamping a real container against
 * a real document, and the restore's REPLAY depends on the document's own
 * height arriving a frame later (the line geometry is measured, and the panel
 * animates its width). happy-dom computes no layout at all.
 *
 * Two things the spec has to get right about this surface, both measured:
 * a tab is a `<div onClick>` with a `title`, so it is addressed by its text
 * inside the editor panel rather than by role (the file tree lists the same
 * names, so the panel scopes every query); and the scroll is driven by a real
 * `scrollTop` assignment plus a `scroll` event, which is exactly what the hook
 * listens for — a wheel would additionally depend on landing on the element.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp, selectors } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** Long enough that the container overflows any pane, short enough to render fast. */
const LONG_LINES = 400;

/** The editor column's scroll container, scoped to the panel that owns it. */
function editorScroller(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]').getByTestId(selectors.TESTID.editorScroller);
}

/**
 * Activate a tab by its path.
 *
 * The tab strip hides tabs past its own width into a "More open files"
 * dropdown (`EditorTabs` measures itself, and the editor panel is narrow), so a
 * tab is not always in the strip. The tab carries its full path as `title` —
 * which is also what makes the lookup unambiguous, since the bare file name
 * appears in the strip, in the dropdown, in the tree and in the document.
 */
async function openTab(page: Parameters<typeof openApp>[0], path: string): Promise<void> {
  const panel = page.locator('[data-panel-id="editor-panel"]');
  const tab = panel.locator(`[title="${path}"]`).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    return;
  }
  await panel.getByRole('button', { name: 'More open files' }).click();
  await panel.getByText(path.split('/').pop() ?? path, { exact: true }).last().click();
}

/**
 * Open a file from the Files tree (the default right panel).
 *
 * The `src` row is a TOGGLE, so it is only clicked when the file row is not
 * already showing — clicking it a second time collapses the directory and the
 * file row disappears (measured: the second call in a spec timed out waiting
 * for it). Both waits are conditions rather than durations: the tree loads
 * asynchronously and the expansion is its own fetch.
 */
async function openFromTree(page: Parameters<typeof openApp>[0], name: string): Promise<void> {
  const files = page.locator('[data-panel-id="right-panel"]');
  const row = files.getByText(name, { exact: true }).first();
  // The expansion is persisted, so the row is often already there; only a
  // COLLAPSED tree needs the `src` toggle. Waiting for the row first is what
  // makes this idempotent — a bare `isVisible()` check raced the tree's first
  // paint, clicked `src` while it was already expanded, and collapsed it.
  const appeared = await row
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    await files.getByText('src', { exact: true }).first().click();
    await expect(row).toBeVisible({ timeout: 15_000 });
  }
  await row.click();
}

test.describe('editor scroll memory', () => {
  test('returning to a tab restores the scroll offset it was left at', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-scroll');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'long.txt'), Array.from({ length: LONG_LINES }, (_, i) => `line ${i + 1}`).join('\n'));
    writeFileSync(join(dir, 'short.txt'), 'short file\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // The Files panel is the default right panel; its tree lists the workspace.
    await openFromTree(page, 'long.txt');

    const panel = page.locator('[data-panel-id="editor-panel"]');
    const scroller = editorScroller(page);
    await expect(scroller).toBeVisible();

    // Scroll well past the first viewport. A condition, not a duration: the
    // container only has a scroll range once the document's height landed.
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(1000);
    await scroller.evaluate((el) => {
      el.scrollTop = 1200;
      el.dispatchEvent(new Event('scroll'));
    });
    const leftAt = await scroller.evaluate((el) => el.scrollTop);
    expect(leftAt).toBeGreaterThan(1000);

    // Switch to another file and back. The second file is opened from the tree
    // (which is how it gets a tab), then both switches are TAB clicks — the
    // offset is recorded on the way out and restored on the way in.
    await openFromTree(page, 'short.txt');
    await expect(panel).toContainText('short file');

    await openTab(page, 'src/long.txt');
    // Polled: the restore is re-applied while the document's height settles.
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 15_000 })
      .toBe(leftAt);

    workspace.dispose();
  });

  test('the offset survives a reload, because it lives in the session state', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-scroll-reload');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'long.txt'), Array.from({ length: LONG_LINES }, (_, i) => `line ${i + 1}`).join('\n'));

    const url = `${server.baseURL}/?folderId=${workspace.id}`;
    await openApp(page, url);
    await openFromTree(page, 'long.txt');

    const scroller = editorScroller(page);
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(1000);
    await scroller.evaluate((el) => {
      el.scrollTop = 900;
      el.dispatchEvent(new Event('scroll'));
    });
    const leftAt = await scroller.evaluate((el) => el.scrollTop);

    // The write is debounced, so wait for the state POST the debounce schedules
    // rather than guessing a duration — and then wait for the RESPONSE, so the
    // row is in SQLite before the reload reads it back.
    await page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/state'),
    );

    // The session blob must land BEFORE the tree is clicked: this spec asserts
    // on the offset the blob restores, so a click that beat the read would be
    // measuring a tab opened against the fallback. `useFileTabs` no longer wipes
    // on the first known root (only on a genuine root CHANGE), so this is a
    // readiness gate rather than a defence against a wipe.
    //
    // The empty editor state is deliberately NOT asserted as a second gate: the
    // tab list is itself persisted (`layout.openedFiles`), so whether the panel
    // shows `Select a file to open` or the file it had open depends on the order
    // the restored blob lands in — a race this spec does not own and does not
    // need, since reopening a file that already has a tab reuses that tab.
    const blob = page.waitForResponse(
      (response) => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/state'),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await blob;
    // Reopened from the tree on purpose: whether the TAB LIST survives a reload
    // is a different question, and this spec is about the OFFSET — the tab id
    // is a hash of the path, so reopening the same file reads the same key.
    await openFromTree(page, 'long.txt');
    await expect
      .poll(async () => editorScroller(page).evaluate((el) => el.scrollTop), { timeout: 15_000 })
      .toBe(leftAt);

    workspace.dispose();
  });
});
