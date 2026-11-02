/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whitespace marks, and the indent guides the editor no longer draws.
 *
 * Three claims, and each one is only visible in a real browser:
 *
 * - NOTHING is painted until text is SELECTED. The mark is produced by a view
 *   plugin, so it only exists once a view mounts; and the always-on versions
 *   (the package's `highlightWhitespace()`, an indent-only mark) look identical
 *   to this one the moment something is selected, so the no-selection case is
 *   the one that tells them apart.
 * - Only the SELECTED characters are painted: a dot per selected space and an
 *   arrow per selected tab. A space outside the selection is never marked.
 * - The dot's colour is resolved from the surface's own ink. The package ships
 *   `#aaa`, which is chroma the palette does not own; a theme rule that lost
 *   the cascade would leave that grey behind, and `getComputedStyle` is the only
 *   reader that sees the difference.
 * - No indent guide is drawn. The vertical rule per nesting level was removed
 *   by request — it read as structure the file does not have — and the assertion
 *   is on the DOM, because a stylesheet that kept `.cm-indent-guide` would paint
 *   nothing while its decorations were gone, which looks identical.
 *
 * The fixture lives in the temp workspace the harness owns, so nothing lands in
 * the repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

const EDITOR = '[data-panel-id="editor-panel"]';

/** Open the seeded file through the Files tree and hand back the surface. */
async function openIndentedFile(page: Parameters<typeof openApp>[0]) {
  await page.getByText('src', { exact: true }).first().click();
  await page.getByText('indent.ts', { exact: true }).first().click();
  const content = page.locator(`${EDITOR} .cm-content`);
  await expect(content).toContainText('function f() {', { timeout: 20_000 });
  return content;
}

test.describe('editor whitespace', () => {
  test('selected indentation is drawn as dots, and a bare caret draws nothing', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-editor-whitespace');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(
      join(workspace.path, 'src', 'indent.ts'),
      ['function f() {', '  const answer = 1;', '  return answer;', '}', ''].join('\n'),
    );

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    const content = await openIndentedFile(page);

    const line = content.locator('.cm-line').filter({ hasText: 'const answer' });

    // A caret paints nothing, however indented the file is. This is the case the
    // always-on versions fail, and the reason the feature is selection-scoped.
    await content.click();
    await page.keyboard.press('ControlOrMeta+Home');
    await expect(content.locator('.cm-whitespace-space, .cm-whitespace-tab')).toHaveCount(0);

    // Select the indented line itself (the file's first line has no indent, so a
    // selection there would prove nothing): `  const answer = 1;` holds FIVE
    // spaces — two of indent and three between its tokens.
    //
    // `ControlOrMeta+Home` left the caret at column 0 of the first line, and
    // `ArrowDown` keeps that goal column, so the caret is already at column 0 of
    // this line and `Shift+End` selects the indent with the rest.
    //
    // Two `Home` presses used to stand here to reach column 0, and they were the
    // flake: on macOS `Home` is CM6's own smart-home, but on Windows/Linux the
    // keymap binds it to `lineStart`, whose command returns `false` at column 0 —
    // so CM6's smart-home runs instead and moves to the end of the indent. Two
    // presses then landed on column 2, the selection skipped the indent, and the
    // count was 3 instead of 5 (measured on `windows-latest`/`ubuntu-latest`).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+End');
    await expect(line.locator('.cm-whitespace-space')).toHaveCount(5, { timeout: 15_000 });
    // The mark holds the character it replaces, so ⌘C still carries spaces.
    expect(await line.locator('.cm-whitespace-space').first().textContent()).toBe(' ');
    // The package's marks are not in the document at all: the stack installs this
    // plugin INSTEAD of `highlightWhitespace()`.
    await expect(content.locator('.cm-highlightSpace')).toHaveCount(0);
    // The space glyph itself is still zero-width in the DOM: the dot is a
    // background, never a `·` character a search or a lint would see.
    expect(await line.textContent()).toBe('  const answer = 1;');

    // The dot is PAINTED — a radial gradient, not an empty span — and it is the
    // surface's own ink rather than the package's grey, so it stays legible in a
    // dark editor theme instead of disappearing.
    const mark = line.locator('.cm-whitespace-space').first();
    const painted = await mark.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        color: style.color,
        opacity: style.opacity,
      };
    });
    // The gradient's stop is `var(--editor-fg, var(--theme-ink))`, resolved by the
    // browser — and the package's `#aaa` would appear here verbatim if its theme
    // had won the cascade.
    expect(painted.backgroundImage).toContain('radial-gradient');
    expect(painted.backgroundImage).not.toContain('170, 170, 170');
    // The same ink the editor paints its text with, read off the surface host so a
    // theme switch is a repaint and not a re-mount.
    const ink = await page
      .locator(`${EDITOR} .cm-editor`)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    expect(painted.backgroundImage).toContain(ink.replace(/^rgba?\(|\)$/g, ''));
    // The marks are dimmer than the code they sit in, or a block reads as solid
    // punctuation.
    expect(Number(painted.opacity)).toBeLessThan(1);

    // And the per-level vertical rules are gone.
    await expect(content.locator('.cm-indent-guide')).toHaveCount(0);

    workspace.dispose();
  });
});
