/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline: a file's declarations, and a click that takes the reader there.
 *
 * Every assertion here needs the assembled product. The rows come from a LIVE
 * editor buffer (not a second read of the file), the jump is a real `scrollTop`
 * on a real scroller plus a real caret in a real `<textarea>`, and the preview
 * branch only exists in a browser — happy-dom computes no layout, so a unit test
 * can prove the request was published but never that the line it named is the
 * line that ended up on screen.
 *
 * Three bugs this layer is here to keep out:
 *
 * 1. **A stale outline.** The buffer is published, never re-read, so a
 *    declaration typed but not yet written to disk must appear. That is the
 *    difference between the row naming the line it holds and the line the file
 *    held a second ago.
 * 2. **A jump that lands nowhere.** The caret and the scroll must move together;
 *    a symbol click that only placed a caret leaves the reader at the top of a
 *    2,800-line file.
 * 3. **A preview that swallows the jump.** A rendered markdown document draws no
 *    code surface, so the click has to switch back to source BEFORE applying the
 *    offset — otherwise it silently does nothing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp, selectors } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { seedWorkingRepoIn } from '../fixtures/git-repo';

const SAMPLE = [
  'export interface WidgetOptions {',
  '  label: string;',
  '}',
  '',
  'export class Widget {',
  '  readonly label: string;',
  '  count = 0;',
  '',
  '  render(): string {',
  '    this.count += 1;',
  '    return this.label;',
  '  }',
  '',
  '  reset = () => {',
  '    this.count = 0;',
  '  };',
  '}',
  '',
  'export function buildWidget(options: WidgetOptions): Widget {',
  '  return new Widget(options);',
  '}',
  '',
  'export const MAX_WIDGETS = 10;',
].join('\n');

/** A file long enough that a jump has to scroll, with one symbol near the end. */
const LONG = Array.from({ length: 120 }, (_, i) => {
  const head = i === 89 ? 'export function targetFunction() {' : `export function fn${i + 1}() {`;
  const body = Array.from({ length: 18 }, (_, j) => `  const v${i}_${j} = ${j};`).join('\n');
  return `${head}\n${body}\n  return 0;\n}\n`;
}).join('\n');

function filesPanel(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="right-panel"]');
}

function editorPanel(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]');
}

/**
 * Open a file from the Files tree.
 *
 * A condition, not a duration: the tree's first read is asynchronous, and the
 * `src` row is a TOGGLE — clicking it while it is already expanded collapses it
 * and the file row disappears (the same trap `editor-scroll.e2e.ts` documents).
 */
async function openFromTree(page: Parameters<typeof openApp>[0], name: string): Promise<void> {
  const files = filesPanel(page);
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

/** The outline section's rows, by their accessible names. */
function outlineRows(page: Parameters<typeof openApp>[0]) {
  return filesPanel(page).getByRole('button', { name: /, line \d+$/ });
}

async function expandOutline(page: Parameters<typeof openApp>[0]): Promise<void> {
  const toggle = filesPanel(page).getByRole('button', { name: 'Outline', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** The caret's 1-based line in the editor's own textarea. */
async function caretLine(page: Parameters<typeof openApp>[0]): Promise<number> {
  return editorPanel(page).locator('textarea').evaluate((el) => {
    const input = el as HTMLTextAreaElement;
    return input.value.slice(0, input.selectionStart).split('\n').length;
  });
}

/**
 * The text the editor has SELECTED, which is what a symbol click is for.
 *
 * Asserting `selectionStart` alone proved only that the caret moved somewhere on
 * the right line — on `export class Widget {` that could be the word `export`.
 * The selection has to be the declaration's own name.
 */
async function selectedText(page: Parameters<typeof openApp>[0]): Promise<string> {
  return editorPanel(page).locator('textarea').evaluate((el) => {
    const input = el as HTMLTextAreaElement;
    return input.value.slice(input.selectionStart, input.selectionEnd);
  });
}

/**
 * Whether the selection is actually DRAWN.
 *
 * `selectionStart`/`selectionEnd` are set on an unfocused textarea all the same,
 * but the browser paints no band and no caret — the reported symptom was a jump
 * that scrolled correctly and selected nothing visible. Focus is the observable
 * that separates the two, and asserting the range alone proved only the half
 * that already worked.
 */
async function selectionIsVisible(page: Parameters<typeof openApp>[0]): Promise<boolean> {
  return editorPanel(page).locator('textarea').evaluate((el) => document.activeElement === el);
}

test.describe('file outline', () => {
  test('lists a file’s declarations and takes the caret to the clicked one', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-outline');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'sample.ts'), SAMPLE);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'sample.ts');

    // Nothing is open until the editor has the file, so the empty state names
    // that state rather than showing an empty list.
    await expect(editorPanel(page)).toContainText('export class Widget');
    await expandOutline(page);

    // The rows, in source order, each naming its KIND and the line it starts
    // on. The kind is part of the accessible name because the mark alone is a
    // shape a screen reader cannot read.
    await expect(outlineRows(page)).toHaveCount(8);
    for (const label of [
      'Interface WidgetOptions, line 1',
      'Class Widget, line 5',
      'Variable label, line 6',
      'Variable count, line 7',
      'Method render, line 9',
      'Method reset, line 14',
      'Function buildWidget, line 19',
      'Constant MAX_WIDGETS, line 23',
    ]) {
      await expect(filesPanel(page).getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    await filesPanel(page).getByRole('button', { name: 'Method reset, line 14' }).click();
    await expect.poll(() => caretLine(page)).toBe(14);
    // The NAME is selected, not the line: `reset` is 3 characters in on that
    // line, and a bare caret at the line's start would select nothing.
    await expect.poll(() => selectedText(page)).toBe('reset');
    // And the selection is VISIBLE: an unfocused textarea holds the range but
    // paints no band and no caret.
    await expect.poll(() => selectionIsVisible(page)).toBe(true);

    workspace.dispose();
  });

  test('follows the live buffer, not the file on disk', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-outline-live');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'sample.ts'), SAMPLE);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'sample.ts');
    await expect(editorPanel(page)).toContainText('export class Widget');
    await expandOutline(page);

    // Type a declaration at the end WITHOUT saving. The autosave is debounced,
    // so at this moment the file on disk still has 23 lines.
    await editorPanel(page).locator('textarea').evaluate((el) => {
      const input = el as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, `${input.value}\nexport function typedLive() {}\n`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The row appears, and it names the line the buffer holds — a panel that
    // re-read the file would never show it.
    const typed = filesPanel(page).getByRole('button', { name: 'Function typedLive, line 24' });
    await expect(typed).toBeVisible();
    await typed.click();
    await expect.poll(() => caretLine(page)).toBe(24);
    await expect.poll(() => selectedText(page)).toBe('typedLive');

    workspace.dispose();
  });

  test('a symbol click scrolls a long file to the line it names', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-outline-scroll');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'long.ts'), LONG);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'long.ts');
    await expect(editorPanel(page)).toContainText('export function fn1()');
    await expandOutline(page);

    const scroller = editorPanel(page).getByTestId(selectors.TESTID.editorScroller);
    // A condition, not a duration: the range exists only once the document's
    // height has landed.
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(1000);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);

    await filesPanel(page).getByRole('button', { name: 'Function targetFunction, line 1959' }).click();

    // Both halves: the declaration is SELECTED and the view followed it.
    await expect.poll(() => caretLine(page)).toBe(1959);
    await expect.poll(() => selectedText(page)).toBe('targetFunction');
    await expect.poll(() => selectionIsVisible(page)).toBe(true);
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);

    workspace.dispose();
  });

  test('a rendered preview switches to source before the jump lands', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-outline-preview');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(
      join(workspace.path, 'src', 'notes.md'),
      ['# Title', '', 'Intro.', '', '## First Section', '', 'Body.', '', '## Second Section', '', 'More.'].join('\n'),
    );

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'notes.md');

    // Markdown opens RENDERED by default, and a rendered document has no code
    // surface for the jump to move — this is the case a click used to lose.
    await expect(editorPanel(page).locator('.prose-content')).toBeVisible();
    await expandOutline(page);

    await filesPanel(page).getByRole('button', { name: 'Heading Second Section, line 9' }).click();

    await expect(editorPanel(page).locator('.prose-content')).toHaveCount(0);
    await expect.poll(() => caretLine(page)).toBe(9);
    // The heading's TEXT is selected — not the `## ` that precedes it.
    await expect.poll(() => selectedText(page)).toBe('Second Section');

    workspace.dispose();
  });

  test('a diff tab hides the outline section instead of explaining it', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-outline-diff');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    const file = join(workspace.path, 'src', 'sample.ts');
    writeFileSync(file, SAMPLE);

    // A REAL repository with a REAL uncommitted change: the Source Control view
    // lists nothing in a plain directory, so without this the diff row the spec
    // clicks never exists (measured — the panel read "No changes found").
    // `seedWorkingRepoIn` commits the tree as it stands, so the change is written
    // AFTER it and shows up as modified.
    const repo = seedWorkingRepoIn(workspace.path, 'e2e-outline-diff');
    writeFileSync(file, `${SAMPLE}\n// changed\n`);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFromTree(page, 'sample.ts');
    await expandOutline(page);
    await expect(outlineRows(page).first()).toBeVisible();

    // Open the SAME file as a diff, then come back to the Files panel. A diff
    // has no source document to outline, so the section is GONE — not left on
    // the panel's floor explaining a question nobody asked.
    await page.getByRole('button', { name: 'Source Control' }).click();
    await filesPanel(page).getByText('sample.ts', { exact: true }).last().click();
    await expect(editorPanel(page)).toContainText('(Diff)');
    await page.getByRole('button', { name: 'Files', exact: true }).click();

    await expect(filesPanel(page)).not.toContainText('Outline');
    await expect(outlineRows(page)).toHaveCount(0);

    // And it comes BACK when the diff is converted to a source tab: hiding is a
    // property of the tab on screen, not a switch the user has to undo. The
    // source tab itself lives behind "More open files" at this panel width, so
    // the diff toolbar's own `Open in code editor` is the real way back.
    await editorPanel(page).getByRole('button', { name: 'Open in code editor' }).click();
    const toggle = filesPanel(page).getByRole('button', { name: 'Outline', exact: true });
    await expect(toggle).toBeVisible();
    // The open flag is per SESSION (`files.outlineExpanded`), so a section that
    // comes back comes back in the state it was left in — no second click.
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(outlineRows(page).first()).toBeVisible();

    repo.dispose();
    workspace.dispose();
  });
});
