/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The find bar over the CodeMirror surface.
 *
 * The matcher moved to CM6's `RegExpCursor` and the marks moved from injected
 * markup to a decoration field, so every observable the bar prints has to be
 * re-proved against the new surface: the count, which match is current, the
 * one-step undo of a replace-all, and the difference between "no results" and
 * "your pattern does not compile".
 *
 * Two of these are only visible assembled. The count comes from the live
 * buffer, and the marks are decorations the editor draws in its own viewport —
 * happy-dom computes no layout, so a unit test can prove the match LIST and
 * never that the list reached the screen.
 *
 * The last case is the bar's own geometry: it is 330px wide and the editor panel
 * defaults to 320px, so a fixed width put its leftmost control past the panel
 * edge and a click there landed on the panel beside it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** 200 lines, so the count is a number the spec can predict. */
const SOURCE = Array.from({ length: 200 }, (_, i) => `const alpha${i} = ${i}; // beta`).join('\n');

function editorPanel(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]');
}

/** The status line the bar prints (`N of M`, `No results`, `Invalid pattern`). */
/**
 * Open a file from the Files tree.
 *
 * The `src` row is a TOGGLE, so it is only clicked when the file row is not
 * already showing: the expansion is persisted, and clicking an expanded
 * directory collapses it.
 */
async function openFromTree(page: Parameters<typeof openApp>[0], name: string) {
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
}

function status(page: Parameters<typeof openApp>[0]) {
  return editorPanel(page).locator('[aria-live="polite"]').first();
}

test.describe('editor find', () => {
  test('counts, steps and paints matches from the live buffer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-find');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), SOURCE);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    await expect(panel.locator('.cm-content')).toContainText('const alpha0', { timeout: 15_000 });

    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+f');
    const field = panel.getByRole('textbox', { name: 'Find', exact: true });
    await expect(field).toBeVisible({ timeout: 5_000 });
    await field.fill('alpha1');

    // 111 = `alpha1` plus `alpha10`–`alpha19`, then `alpha100`–`alpha199`.
    await expect(status(page)).toHaveText(/of 111$/, { timeout: 5_000 });
    // Marks are decorations over the viewport, so the count is bounded by what
    // is rendered — the point is that they exist and one of them is current.
    await expect(panel.locator('.find-match').first()).toBeVisible();
    await expect(panel.locator('.find-match[data-find-current]')).toHaveCount(1);

    const before = await status(page).innerText();
    await panel.getByRole('button', { name: 'Next match' }).click();
    await expect(status(page)).not.toHaveText(before, { timeout: 5_000 });
    // Stepping moves the highlight with the counter; it never adds a second
    // "current" mark.
    await expect(panel.locator('.find-match[data-find-current]')).toHaveCount(1);

    workspace.dispose();
  });

  test('replace-all is one undoable step and an invalid pattern is named', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-find-replace');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), SOURCE);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    await expect(panel.locator('.cm-content')).toContainText('const alpha0', { timeout: 15_000 });

    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+f');
    await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('alpha1');
    // The bar fits the panel, so its own control is reachable at the default
    // width — the click is the assertion.
    await panel.getByRole('button', { name: 'Show replace' }).click();
    await panel.getByRole('textbox', { name: 'Replace', exact: true }).fill('OMEGA');
    await panel.getByRole('button', { name: 'Replace all', exact: true }).click();

    await expect(panel.locator('.cm-content')).toContainText('OMEGA', { timeout: 5_000 });

    // The replacement must reach the OWNER, not just the editor: a write the
    // surface suppresses (it is a user edit, not an external sync) leaves the
    // parent holding the old buffer, so the autosave never sees it and the next
    // render writes the old text back over the document. Both halves are
    // observable — the bytes on disk, and the buffer after a tab switch.
    await expect
      .poll(() => readFileSync(join(workspace.path, 'src', 'a.ts'), 'utf8'), { timeout: 15_000 })
      .toContain('OMEGA');

    // One transaction, so one undo: a replace-all that took a step per match is
    // the failure the surface's single `applyDocument` exists to prevent.
    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(panel.locator('.cm-content')).not.toContainText('OMEGA', { timeout: 5_000 });
    await expect(panel.locator('.cm-content')).toContainText('const alpha1');

    // A pattern that does not compile is a different answer from "no results".
    await panel.getByRole('button', { name: /Use regular expression/ }).click();
    await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('(');
    await expect(status(page)).toHaveText('Invalid pattern', { timeout: 5_000 });

    workspace.dispose();
  });

  test('the query and its options survive a reload', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-find-persist');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), SOURCE);

    const url = `${server.baseURL}/?folderId=${workspace.id}`;
    await openApp(page, url);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    await expect(panel.locator('.cm-content')).toContainText('const alpha0', { timeout: 15_000 });

    // The query lives in the session state, whose write is debounced; the POST
    // is the gate rather than a duration — and it is armed BEFORE the edits, so
    // a write the first keystroke schedules cannot land ahead of the wait.
    const write = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/state'),
    );
    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+f');
    await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('beta');
    await panel.getByRole('button', { name: /Match case/ }).click();
    await write;

    // Armed BEFORE the reload: the blob is read while the document loads, so a
    // gate created after `reload()` resolves has already missed it.
    const blob = page.waitForResponse(
      (response) => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/state'),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await blob;
    await openFromTree(page, 'a.ts');
    await expect(editorPanel(page).locator('.cm-content')).toContainText('const alpha0', { timeout: 15_000 });
    await editorPanel(page).locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+f');

    // The bar is NOT reopened by the reload (that is deliberate), but the query
    // and the option it was given are still there.
    await expect(editorPanel(page).getByRole('textbox', { name: 'Find', exact: true })).toHaveValue('beta');
    await expect(editorPanel(page).getByRole('button', { name: /Match case/ })).toHaveAttribute('aria-pressed', 'true');

    workspace.dispose();
  });
});
