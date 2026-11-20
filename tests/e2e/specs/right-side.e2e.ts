/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right SIDE as one switch, and the editor column's own corner control.
 *
 * Two behaviours a unit test cannot show, both measured on the assembled app:
 *
 * 1. The navbar's toggle puts away the editor column, the right panel AND the
 *    activity rail, and the next click brings all three back. The reported bug
 *    was a toggle that collapsed only the panel, leaving a rail of marks beside
 *    a zero-width column and the editor at full width.
 * 2. The editor column's own switch moved from that navbar row to its top-right
 *    corner, so hiding the column no longer hides the side.
 *
 * A collapsed panel keeps its DOM and takes zero width (that is what preserves a
 * terminal's buffer and a tree's expansion), so `toBeHidden()` is the assertion
 * for the columns and an absence assertion for the rail, which is not rendered
 * at all while the side is away.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

const rightRail = 'Right panel views';

test.describe('the right side', () => {
  test('one toggle hides the editor, the right panel and the rail; the next shows them', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-right-side');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'note.txt'), 'hello\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // A file tab is what gives the editor column content, so the case covers
    // the column rather than only the panel.
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('note.txt', { exact: true }).first().click();

    const editorPanel = page.locator('[data-panel-id="editor-panel"]');
    const rightPanel = page.locator('[data-panel-id="right-panel"]');
    await expect(editorPanel).toBeVisible();
    await expect(rightPanel).toBeVisible();

    const toggle = page.getByRole('button', { name: /toggle right side/i });
    await toggle.click();

    await expect(rightPanel).toBeHidden();
    await expect(editorPanel).toBeHidden();
    // The rail goes with the columns: it is how a view is CHOSEN, and a rail
    // beside two collapsed columns switches nothing.
    await expect(page.getByRole('navigation', { name: rightRail })).toHaveCount(0);

    await toggle.click();

    await expect(editorPanel).toBeVisible();
    await expect(rightPanel).toBeVisible();
    await expect(page.getByRole('navigation', { name: rightRail })).toBeVisible();

    workspace.dispose();
  });

  test('the editor column switches from its own corner, leaving the right side standing', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-right-side-corner');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'note.txt'), 'hello\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('note.txt', { exact: true }).first().click();

    const editorPanel = page.locator('[data-panel-id="editor-panel"]');
    const rightPanel = page.locator('[data-panel-id="right-panel"]');
    await expect(editorPanel).toBeVisible();

    const hide = editorPanel.getByRole('button', { name: /hide editor panel/i });
    await expect(hide).toBeVisible();
    await hide.click();

    await expect(editorPanel).toBeHidden();
    // The column's own switch is not the side's: the panel and the rail stay.
    await expect(rightPanel).toBeVisible();
    await expect(page.getByRole('navigation', { name: rightRail })).toBeVisible();

    workspace.dispose();
  });
});
