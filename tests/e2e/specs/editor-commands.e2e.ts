/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's own commands, against a real keyboard.
 *
 * Two of them have no unit-level proof. `⌘/` reaches CodeMirror's `toggleComment`,
 * which reads its tokens from a `languageData` provider — a provider that
 * returns the tokens in the wrong shape yields an empty list and the command
 * silently does nothing, which is exactly how it shipped once. `Tab` is the
 * editor's own binding, and what matters is that it indents rather than moving
 * focus out of the document.
 *
 * `editor-commands.test.ts` pins the same two against a bare `EditorState`; this
 * pins the WIRING — that the keymap, the extension stack and the panel's capture
 * handler agree about what a key does.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

function editorPanel(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]');
}

/** Open a file from the Files tree, tolerating an already-expanded `src`. */
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

/**
 * The document's lines as the editor holds them.
 *
 * The trailing empty entry a file's final newline opens is dropped: it is part
 * of the document, not a line the assertions below are about, and every fixture
 * here ends with a newline.
 */
function lines(page: Parameters<typeof openApp>[0]) {
  return editorPanel(page)
    .locator('.cm-content')
    .evaluate((el) => {
      const text = Array.from(el.querySelectorAll('.cm-line')).map((line) => line.textContent ?? '');
      if (text.length > 0 && text[text.length - 1] === '') text.pop();
      return text;
    });
}

test.describe('editor commands', () => {
  test('⌘/ comments with the language’s own token', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-cmd-comment');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const alpha = 1;\n');
    writeFileSync(join(workspace.path, 'src', 'b.yaml'), 'key: value\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    await expect(panel.locator('.cm-content')).toContainText('const alpha', { timeout: 15_000 });

    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+/');
    await expect.poll(() => lines(page)).toEqual(['// const alpha = 1;']);

    // The token is the language's: a `//` in YAML is a syntax error.
    await openFromTree(page, 'b.yaml');
    await expect(panel.locator('.cm-content')).toContainText('key: value', { timeout: 15_000 });
    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+/');
    await expect.poll(() => lines(page)).toEqual(['# key: value']);

    workspace.dispose();
  });

  test('Tab indents instead of leaving the document', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-cmd-tab');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const alpha = 1;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    await expect(panel.locator('.cm-content')).toContainText('const alpha', { timeout: 15_000 });

    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Tab');
    await expect.poll(() => lines(page)).toEqual(['  const alpha = 1;']);

    // And the focus never left the document: a second Tab still indents.
    await page.keyboard.press('Tab');
    await expect.poll(() => lines(page)).toEqual(['    const alpha = 1;']);

    workspace.dispose();
  });

  test('the generated keymap reaches the buffer commands', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-cmd-keymap');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const one = 1;\nconst two = 2;\nconst three = 3;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = editorPanel(page);
    await openFromTree(page, 'a.ts');
    const content = panel.locator('.cm-content');
    await expect(content).toContainText('const one', { timeout: 15_000 });

    await content.click();
    await page.keyboard.press('ControlOrMeta+Home');

    // ⌘⇧K — a row the keymap table lists, run by CM6's own `deleteLine`.
    await page.keyboard.press('ControlOrMeta+Shift+k');
    await expect.poll(() => lines(page)).toEqual(['const two = 2;', 'const three = 3;']);

    // ⌥↓ — `moveLineDown`, which is a CM6 command and NOT a text-command table
    // entry any more.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => lines(page)).toEqual(['const three = 3;', 'const two = 2;']);

    // ⌘D twice — CM6's `selectNextOccurrence`, with the second cursor visible.
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+d');
    await expect(panel.locator('.cm-selectionBackground').first()).toBeVisible();
    await page.keyboard.type('Q');
    await expect.poll(async () => (await lines(page))[0]).toBe('Q three = 3;');

    workspace.dispose();
  });

  test('a viewer cannot be typed into', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-cmd-viewer');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    // A PNG is a byte viewer: it owns the surface and has no buffer.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    writeFileSync(join(workspace.path, 'src', 'pixel.png'), png);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'pixel.png');
    // A byte viewer draws no code surface at all — the strongest form of
    // read-only is having nothing to type into.
    await expect(editorPanel(page).locator('.cm-content')).toHaveCount(0, { timeout: 15_000 });

    workspace.dispose();
  });
});
