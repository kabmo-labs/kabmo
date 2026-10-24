/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor panel: open a file from the tree, edit it, save it.
 *
 * The save path is the point. It is a `POST /api/fs/write` whose outcome the
 * toolbar reports through `saveStatus` (`idle → saving → saved`, or `error`) —
 * and the failure branch is the one worth pinning, because a silent save
 * failure left the user believing the file was written. A unit test covers the
 * hook's state machine; only this shows the toolbar a person clicks going
 * through it against a real filesystem.
 *
 * The assertion is on the FILE ON DISK, not on the button. The saved state is
 * an icon swap (a check replacing the save glyph) and the control's accessible
 * name does not change, so a role-based assertion cannot see it — and "the
 * bytes landed" is the claim that matters anyway.
 *
 * The file lives in the seeded workspace, so the write lands in a temp
 * directory the harness removes — never in the repository.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

test.describe('editor', () => {
  test('opens a file and saves an edit to disk', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor');
    // The fixture file (written directly — it is the setup, not the behaviour
    // under test) lives in the temp workspace the harness owns.
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'greeting.txt');
    writeFileSync(filePath, 'hello world\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // Files is the default right panel; its tree lists the workspace root.
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('greeting.txt', { exact: true }).first().click();

    // Scoped to the editor panel, and addressed as the contenteditable CM6
    // renders: the surface is no longer a `<textarea>`, and the chat composer
    // still is, so an unscoped `textarea` locator would resolve to the composer.
    const editorPanel = page.locator('[data-panel-id="editor-panel"]');
    const editor = editorPanel.locator('.cm-content');
    await expect(editor).toContainText('hello world', { timeout: 15_000 });

    // Edit, then save through the toolbar's own control — it carries the
    // `title`/`aria-label` pair every icon-only button in this app does.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('hello e2e\n');
    const save = editorPanel.getByRole('button', { name: /save file/i }).first();
    await expect(save).toBeEnabled();
    const written = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/fs'),
    );
    await save.click();
    await written;

    // The file on disk is the claim. Polled, because the write's response can
    // land a tick before the filesystem settles.
    await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 15_000 }).toBe('hello e2e\n');

    workspace.dispose();
  });

  test('the surface is a contenteditable with the mobile input attributes', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-attrs');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.ts'), 'const alpha = 1;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('notes.ts', { exact: true }).first().click();

    const content = page.locator('[data-panel-id="editor-panel"] .cm-content');
    await expect(content).toContainText('const alpha', { timeout: 15_000 });

    // These four are what keep a phone keyboard from "correcting" code: the
    // browser's spellchecker underlines every identifier, autocorrect rewrites
    // them, autocapitalise upper-cases a line start, and `translate` would let
    // a translation extension rewrite the document.
    const attributes = await content.evaluate((el) => ({
      spellcheck: el.getAttribute('spellcheck'),
      autocorrect: el.getAttribute('autocorrect'),
      autocapitalize: el.getAttribute('autocapitalize'),
      translate: el.getAttribute('translate'),
      editable: el.getAttribute('contenteditable'),
      role: el.getAttribute('role'),
    }));
    expect(attributes).toEqual({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      translate: 'no',
      editable: 'true',
      role: 'textbox',
    });

    workspace.dispose();
  });
});
