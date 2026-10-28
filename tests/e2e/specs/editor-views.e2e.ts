/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's two WIDTH modes, entered from either toolbar.
 *
 * Three claims, and each one is invisible to a unit test because it is about
 * the assembled layout rather than about state:
 *
 * - Compact view collapses the CHAT and leaves the sidebar and the right panel
 *   standing, so the editor takes exactly the width the chat had.
 * - Full view collapses the chat AND the sidebar, and still leaves the right
 *   panel — the outline, search hits and the diff list are what a wider
 *   document is read against.
 * - Clicking the active mode returns to the ordinary layout.
 *
 * The measurements are real bounding boxes: `Panel` renders a collapsed panel
 * at zero width, and a state-only assertion would pass with the columns still
 * on screen.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { seedWorkingRepo } from '../fixtures/git-repo';

/** Width of one of the layout's panels, as the browser laid it out. */
async function panelWidth(page: Parameters<typeof openApp>[0], id: string): Promise<number> {
  return page.locator(`[data-panel-id="${id}"]`).evaluate((el) => el.getBoundingClientRect().width);
}

/** The editor column's own toolbar, which is where the mode buttons live. */
function editorToolbar(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]');
}

/**
 * Open a file from the Files tree, the way the editor spec does: the `src` row
 * is a toggle, so it is only clicked when the file row is not already there.
 */
async function openFile(page: Parameters<typeof openApp>[0], name: string): Promise<void> {
  const files = page.locator('[data-panel-id="right-panel"]');
  const row = files.getByText(name, { exact: true }).first();
  const appeared = await row
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    await files.getByText('src', { exact: true }).first().click();
    await expect(row).toBeVisible({ timeout: 15_000 });
  }
  await row.click();
  await expect(editorToolbar(page).locator('.cm-content')).toBeVisible({ timeout: 15_000 });
}

/** The toolbar bar: its height, and the buttons on its row. */
async function toolbarInfo(page: Parameters<typeof openApp>[0], panel: 'editor-panel' | 'right-panel') {
  return page.locator(`[data-panel-id="${panel}"]`).evaluate((el) => {
    const bar = el.querySelector('div[class*="@container"]') as HTMLElement | null;
    if (!bar) return null;
    const row = bar.querySelector<HTMLElement>('div.flex-nowrap');
    return {
      barHeight: bar.clientHeight,
      rowHeight: row?.clientHeight ?? 0,
      labels: [...bar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    };
  });
}

test.describe('editor width modes', () => {
  test('compact hides the chat; full also hides the sidebar; both keep the right panel', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-views');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'notes.txt'), 'hello views\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFile(page, 'notes.txt');

    // The ordinary layout: both columns stand.
    expect(await panelWidth(page, 'center-panel')).toBeGreaterThan(100);
    expect(await panelWidth(page, 'left-panel')).toBeGreaterThan(100);

    const toolbar = editorToolbar(page);
    await toolbar.getByRole('button', { name: 'Compact view' }).click();

    // Compact: the chat is gone and the editor absorbed it, the sidebar stays.
    await expect.poll(() => panelWidth(page, 'center-panel'), { timeout: 10_000 }).toBeLessThan(2);
    expect(await panelWidth(page, 'left-panel')).toBeGreaterThan(100);
    expect(await panelWidth(page, 'right-panel')).toBeGreaterThan(100);
    // Polled: a panel's width ANIMATES (200ms), so a single read after the chat
    // collapses catches the editor mid-transition at its old width.
    await expect.poll(() => panelWidth(page, 'editor-panel'), { timeout: 10_000 }).toBeGreaterThan(500);
    // The button reports its own state, so the pair reads as a mode selection.
    await expect(toolbar.getByRole('button', { name: 'Compact view' })).toHaveAttribute('aria-pressed', 'true');

    await toolbar.getByRole('button', { name: 'Full view' }).click();

    // Full: the sidebar goes too, and the right panel is still standing. Every
    // width read is POLLED, because a panel's width animates over 200ms and a
    // single read after a click catches it mid-transition.
    await expect.poll(() => panelWidth(page, 'left-panel'), { timeout: 10_000 }).toBeLessThan(2);
    await expect.poll(() => panelWidth(page, 'right-panel'), { timeout: 10_000 }).toBeGreaterThan(100);
    expect(await panelWidth(page, 'center-panel')).toBeLessThan(2);
    await expect(toolbar.getByRole('button', { name: 'Compact view' })).toHaveAttribute('aria-pressed', 'false');
    // The editor now owns everything the right panel does not.
    await expect.poll(() => panelWidth(page, 'editor-panel'), { timeout: 10_000 }).toBeGreaterThan(500);

    // Clicking the active mode is the way back to the ordinary layout.
    await toolbar.getByRole('button', { name: 'Full view' }).click();
    await expect.poll(() => panelWidth(page, 'left-panel'), { timeout: 10_000 }).toBeGreaterThan(100);
    await expect.poll(() => panelWidth(page, 'center-panel'), { timeout: 10_000 }).toBeGreaterThan(100);
    await expect(toolbar.getByRole('button', { name: 'Full view' })).toHaveAttribute('aria-pressed', 'false');

    workspace.dispose();
  });

  test('the mode survives a reload, and the sidebar toggle leaves full view', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-views-persist');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'notes.txt'), 'hello views\n');

    const url = `${server.baseURL}/?folderId=${workspace.id}`;
    await openApp(page, url);
    await openFile(page, 'notes.txt');

    // The mode is per session and persisted on the same 600ms debounce as the
    // rest of the layout, so the reload waits for the write rather than a sleep.
    const persisted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && /\/api\/sessions\/.+\/state$/.test(new URL(response.url()).pathname),
    );
    await editorToolbar(page).getByRole('button', { name: 'Full view' }).click();
    await persisted;
    await expect.poll(() => panelWidth(page, 'left-panel'), { timeout: 10_000 }).toBeLessThan(2);

    // The sidebar toggle is the navbar's, and it must actually produce the
    // sidebar: flipping the raw flag alone left the mode hiding it.
    await page.getByRole('button', { name: /expand sidebar/i }).click();
    await expect.poll(() => panelWidth(page, 'left-panel'), { timeout: 10_000 }).toBeGreaterThan(100);
    // Stepping out of full view lands on compact — the wider editor stays.
    expect(await panelWidth(page, 'center-panel')).toBeLessThan(2);
    await expect(editorToolbar(page).getByRole('button', { name: 'Compact view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    workspace.dispose();
  });

  test('the editor toolbar stays ONE row at the panel floor', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-views-row');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'notes.txt'), 'hello views\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFile(page, 'notes.txt');

    // The editor panel opens at its 320px floor. A WRAPPED strip made the bar
    // 72px tall (two rows of controls), which moved the document down by a
    // whole row and read as a second toolbar. One row is the claim, and the
    // height is what proves it — only the browser resolves which layout the row
    // actually took.
    const bar = await toolbarInfo(page, 'editor-panel');
    expect(bar).not.toBeNull();
    expect(bar!.barHeight).toBeLessThan(56);
    expect(bar!.rowHeight).toBeLessThan(40);

    // The width modes and full screen are the reason this toolbar grew these
    // buttons, so they are on the row rather than behind `⋯`.
    expect(bar!.labels).toContain('Compact view');
    expect(bar!.labels).toContain('Full view');
    expect(bar!.labels).toContain('Full screen');
    // And nothing is drawn past the panel's edge.
    const overflow = await page
      .locator('[data-panel-id="editor-panel"] div[class*="@container"]')
      .first()
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    workspace.dispose();
  });

  test('the diff toolbar offers the same two modes', async ({ harness, page }) => {
    const server = await harness('real');
    // A real repository with one uncommitted change: the panel reads the working
    // tree, and a fixture row would skip the route that computes the diff.
    const repo = seedWorkingRepo('editor-views-diff');
    writeFileSync(join(repo.path, 'notes.txt'), 'hello views\n');
    repo.git('add', '.');
    repo.git('commit', '-qm', 'init');
    writeFileSync(join(repo.path, 'notes.txt'), 'hello views, edited\n');

    const folder = (await fetch(`${server.baseURL}/api/folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'editor-views-diff', path: repo.path }),
    }).then((response) => response.json())) as { folder?: { id: number | string } };

    await openApp(page, `${server.baseURL}/?folderId=${folder.folder?.id}`);
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const right = page.locator('[data-panel-id="right-panel"]');
    const row = right.getByText('notes.txt', { exact: true }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const toolbar = editorToolbar(page);
    await expect(toolbar.locator('.cm-mergeView, .cm-editor').first()).toBeVisible({ timeout: 15_000 });
    // The diff toolbar carries more controls than the editor's, so at the same
    // 320px floor the tail moves into `⋯` — one row, nothing clipped, every
    // control still one click away.
    const bar = await toolbarInfo(page, 'editor-panel');
    expect(bar!.barHeight).toBeLessThan(56);
    expect(bar!.labels).toContain('More actions');
    await toolbar.getByRole('button', { name: 'More actions' }).click();
    const items = await page.locator('[role="menuitem"]').allTextContents();
    expect(items.join('|')).toContain('Word wrap on');
    await page.keyboard.press('Escape');

    // Same two buttons, same slot: a mode entered from a diff is the mode the
    // file tab shows. They are pinned, so they are on the row rather than in the
    // menu.
    await toolbar.getByRole('button', { name: 'Compact view' }).click();
    await expect.poll(() => panelWidth(page, 'center-panel'), { timeout: 10_000 }).toBeLessThan(2);
    expect(await panelWidth(page, 'right-panel')).toBeGreaterThan(100);

    repo.dispose();
  });
});
