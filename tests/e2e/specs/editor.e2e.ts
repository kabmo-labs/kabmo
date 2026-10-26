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

  // The file ceiling is what the panel will OPEN, and the numbers moved when the
  // surface became CodeMirror: 5 MiB was a textarea's limit, and a 6 MB generated
  // source file is ordinary. The ceiling's own table is in `file-kind.ts`; this
  // case is the assembled proof that a file past the OLD limit opens, edits and
  // saves, because a constant and a route that disagree is how the number and the
  // refusal sentence drift apart.
  test('a file past the old 5 MB ceiling opens, edits and saves', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-big');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    // Built to a SIZE, not a line count: the claim is "past the old 5 MiB
    // ceiling", so the fixture has to clear it by construction. Each row is ~30
    // bytes, and a marker sits at the very END so reaching it proves the whole
    // document arrived rather than just the first viewport.
    const row = (i: number) => `export const row${i} = ${i};`;
    const rows: string[] = [];
    let bytes = 0;
    for (let i = 0; bytes < 6 * 1024 * 1024; i += 1) {
      const line = row(i);
      rows.push(line);
      bytes += line.length + 1;
    }
    rows.push("export const LAST_ROW = 'tail-marker';");
    const filePath = join(dir, 'big.ts');
    writeFileSync(filePath, rows.join('\n'));

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('big.ts', { exact: true }).first().click();

    const panel = page.locator('[data-panel-id="editor-panel"]');
    const editor = panel.locator('.cm-content');
    // The refusal is a real outcome for this file if the ceiling regresses, so a
    // failure says which one happened rather than timing out on an empty panel.
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await expect(panel).not.toContainText('larger than the');

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' // edited');
    const save = panel.getByRole('button', { name: /save file/i }).first();
    const written = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/fs'),
    );
    await save.click();
    await written;

    await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 30_000 }).toContain('// edited');

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

  /**
   * A dropped file OPENS; it is never inserted into the buffer.
   *
   * CodeMirror handles `drop` itself: for a drag carrying files it reads each
   * file's TEXT and inserts it at the pointer, then calls `preventDefault`. So
   * the panel's own handler saw `defaultPrevented` and stood down, and the
   * debounced autosave then wrote the dropped file's bytes into the OPEN file.
   * Measured before the fix: dropping `b.ts` on `a.ts` left `a.ts` reading
   * `DROPPED_CONTENT` on disk.
   *
   * Only a browser can prove this — the race is between two real listeners on a
   * real contenteditable — and the assertion is on the TAB (the file opened) and
   * on the buffer (the text did not land), which are the two halves of the
   * promise the drop overlay makes.
   */
  test('a dropped file opens instead of being inserted into the buffer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-drop');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'const alpha = 1;\n');
    writeFileSync(join(dir, 'b.ts'), 'DROPPED_CONTENT\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByText('src', { exact: true }).first().click();
    await page.getByText('a.ts', { exact: true }).first().click();

    const panel = page.locator('[data-panel-id="editor-panel"]');
    await expect(panel.locator('.cm-content')).toContainText('const alpha', { timeout: 15_000 });

    // A path-carrying drag (`text/uri-list`), which is what a page or a file
    // manager on Linux hands over. `DataTransfer` cannot be constructed with
    // files in a page, so this is the shape the spec can produce — and it is the
    // one the same handler resolves.
    const prevented = await page.evaluate((absolute) => {
      const target = document.querySelector('[data-panel-id="editor-panel"] .cm-content');
      if (!target) return null;
      const transfer = new DataTransfer();
      transfer.setData('text/uri-list', `file://${absolute}`);
      transfer.setData('text/plain', absolute);
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: 10,
        clientY: 10,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }, join(dir, 'b.ts'));
    expect(prevented).toBe(true);

    // The dropped file opened as its own tab…
    await expect(panel.locator('[title="src/b.ts"]').first()).toBeVisible({ timeout: 15_000 });
    // …and its text is NOT in the buffer it was dropped on.
    //
    // The assertion has to NAME the file it is about. Opening a file ACTIVATES
    // it, so by the time `b.ts`'s tab is on screen the editor holds `b.ts` —
    // whose own content is `DROPPED_CONTENT`. The old form (`.cm-content` alone)
    // passed only by winning a race against the document swap: measured, it held
    // for 33 consecutive polls with exactly the text it was asking not to see.
    // `a.ts` is reached through the tree rather than its tab, because the tab
    // strip at this panel width (320px) shows one tab and keeps the rest behind
    // "More open files" — a click on a hidden tab is a different assertion.
    await page.getByText('a.ts', { exact: true }).first().click();
    await expect(panel.locator('.cm-content')).toContainText('const alpha = 1;');
    await expect(panel.locator('.cm-content')).not.toContainText('DROPPED_CONTENT');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const alpha = 1;\n');

    workspace.dispose();
  });

  test('the status bar reports the caret, the indent and the ending', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-status-bar');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const one = 1;\nconst two = 2;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = page.locator('[data-panel-id="editor-panel"]');
    const files = page.locator('[data-panel-id="right-panel"]');
    const row = files.getByText('a.ts', { exact: true }).first();
    const appeared = await row.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      await files.getByText('src', { exact: true }).first().click();
      await expect(row).toBeVisible({ timeout: 15_000 });
    }
    await row.click();

    const bar = panel.locator('[data-editor-status-bar]');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    // The three facts the strip exists for: where the caret is, how a level is
    // indented, and how the file ends. A readout that printed none of them would
    // still be "visible", so each is asserted by its own words.
    await expect(bar).toContainText('Ln 1, Col 1');
    await expect(bar).toContainText('Spaces: 2');
    await expect(bar).toContainText('lf');
    await expect(bar).toContainText('typescript');

    // Moving the caret moves the readout — the surface reports it, the strip does
    // not count lines itself.
    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await expect(bar).toContainText('Ln 2, Col 1');

    workspace.dispose();
  });

  test('a tab with unsaved edits shows a dot instead of the close glyph', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-dirty-dot');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const alpha = 1;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = page.locator('[data-panel-id="editor-panel"]');
    const files = page.locator('[data-panel-id="right-panel"]');
    const row = files.getByText('a.ts', { exact: true }).first();
    const appeared = await row.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      await files.getByText('src', { exact: true }).first().click();
      await expect(row).toBeVisible({ timeout: 15_000 });
    }
    await row.click();

    await expect(panel.locator('.cm-content')).toContainText('const alpha', { timeout: 15_000 });
    // Clean: no dot anywhere.
    await expect(panel.locator('[data-tab-dirty]')).toHaveCount(0);

    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('x');
    // Dirty: the dot appears, and the tab's close control says so.
    await expect(panel.locator('[data-tab-dirty]')).toHaveCount(1, { timeout: 10_000 });
    await expect(panel.getByTitle(/unsaved changes/).first()).toBeVisible();

    workspace.dispose();
  });

  test('the tab menu closes others and reopens the one it closed', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-tab-menu');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      writeFileSync(join(workspace.path, 'src', name), `// ${name}\n`);
    }

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = page.locator('[data-panel-id="editor-panel"]');
    const files = page.locator('[data-panel-id="right-panel"]');
    if (!(await files.getByText('a.ts', { exact: true }).first().isVisible().catch(() => false))) {
      await files.getByText('src', { exact: true }).first().click();
      await expect(files.getByText('a.ts', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      await files.getByText(name, { exact: true }).first().click();
      await expect(panel.locator('.cm-content')).toContainText(`// ${name}`, { timeout: 15_000 });
    }

    // Only the ACTIVE tab is guaranteed to be on the strip: at the panel's width the rest
    // fold into "More open files", which is the observable used below rather than a row
    // that may not be rendered.
    const overflow = panel.getByRole('button', { name: 'More open files' });
    await expect(overflow).toBeVisible({ timeout: 10_000 });

    // Right-click the visible (active) tab.
    await panel.getByTitle(/^src\/c\.ts$/).first().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Tab actions' });
    await expect(menu).toBeVisible({ timeout: 10_000 });

    // `Close others` leaves exactly the tab it was opened on, so nothing is left to fold
    // into the overflow menu.
    await menu.getByRole('menuitem', { name: 'Close others' }).click();
    await expect(overflow).toHaveCount(0, { timeout: 10_000 });
    await expect(panel.getByTitle(/^src\/c\.ts$/).first()).toBeVisible();

    // And `Reopen closed tab` brings one back — the whole reason the stack exists.
    await panel.getByTitle(/^src\/c\.ts$/).first().click({ button: 'right' });
    await page.getByRole('menu', { name: 'Tab actions' })
      .getByRole('menuitem', { name: 'Reopen closed tab' })
      .click();
    await expect(overflow).toBeVisible({ timeout: 10_000 });

    workspace.dispose();
  });

  test('the status bar switches the line ending the next save writes', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-eol-switch');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const alpha = 1;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const panel = page.locator('[data-panel-id="editor-panel"]');
    const files = page.locator('[data-panel-id="right-panel"]');
    const row = files.getByText('a.ts', { exact: true }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await files.getByText('src', { exact: true }).first().click();
      await expect(row).toBeVisible({ timeout: 15_000 });
    }
    await row.click();
    await expect(panel.locator('.cm-content')).toContainText('const alpha', { timeout: 15_000 });

    const eolButton = panel.locator('[data-editor-status-bar]').getByRole('button', { name: /Line endings/ });
    await expect(eolButton).toContainText('lf');

    // Switch it, edit, save: the file on disk must now carry CRLF.
    await eolButton.click();
    await expect(eolButton).toContainText('crlf');
    await panel.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('// end');
    await page.keyboard.press('ControlOrMeta+s');
    await expect
      .poll(() => readFileSync(join(workspace.path, 'src', 'a.ts'), 'utf8'), { timeout: 15_000 })
      .toContain('\r\n');

    workspace.dispose();
  });
});
