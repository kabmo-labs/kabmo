/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Review annotations on a rendered markdown document.
 *
 * What only the assembled product can prove:
 *
 * - The toolbar button is the ONLY way in. Off (the default), the rendered
 *   document carries no block attributes; on, each block becomes clickable.
 * - A judgement is PERSISTED and painted back onto the rendered DOM
 *   (`data-md-verdict`) after a reload — read from `document_annotations`, not
 *   from component state.
 * - An edit to a judged block reports it as OUTDATED with the note intact
 *   instead of dropping it.
 * - Sending writes the composer draft and does not submit it.
 *
 * Measured facts this spec depends on: the preview's scroller carries
 * `data-testid="editor-scroller"`, reviewed blocks carry `data-md-block`, and
 * the toggle's accessible name is "Review this document".
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

const DOCUMENT = [
  '# Release notes',
  '',
  'The first paragraph is fine as it stands.',
  '',
  '## Known issues',
  '',
  'This section is stale and should be rewritten.',
  '',
  '- one item',
  '- another item',
].join('\n');

/**
 * Open `docs/NOTES.md` from the Files tree.
 *
 * The tree lists a folder collapsed, so the row only exists after the folder is
 * expanded — the same gesture the editor spec's `src` click makes. The folder
 * row is awaited first: the tree's own first read is what makes it clickable,
 * and a click into a loading tree opens nothing.
 */
async function openNotes(page: Parameters<typeof openApp>[0]) {
  const folder = page.getByText('docs', { exact: true }).first();
  await expect(folder).toBeVisible({ timeout: 20_000 });
  await folder.click();
  const row = page.getByText('NOTES.md', { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
}

/** A file at the workspace root: no folder to expand. */
async function openRootDocument(page: Parameters<typeof openApp>[0], name: string) {
  const row = page.getByText(name, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
}

test.describe('document review', () => {
  test('marks a block, keeps the mark across a reload, and prefills the composer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-review');
    mkdirSync(join(workspace.path, 'docs'), { recursive: true });
    writeFileSync(join(workspace.path, 'docs', 'NOTES.md'), DOCUMENT);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openNotes(page);

    const scroller = page.locator(`[data-testid="${TESTID.editorScroller}"]`);
    await expect(scroller).toContainText('Release notes', { timeout: 20_000 });

    // 1. OFF by default: the document renders exactly as it always did.
    await expect(scroller.locator('[data-md-block]')).toHaveCount(0);

    // 2. The toolbar button turns the mode on, and the render becomes mapped.
    await page.getByRole('button', { name: 'Review this document' }).click();
    await expect(scroller.locator('[data-md-block]').first()).toBeVisible({ timeout: 15_000 });

    // 3. Clicking the stale section opens the judge panel; "Needs work" stores it.
    await scroller.getByText('This section is stale and should be rewritten.').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/what is wrong/i).fill('basi setelah §3 berubah');
    await dialog.getByRole('button', { name: 'Needs work' }).click();
    await expect(dialog).toBeHidden();

    // The mark is painted on the block itself, which is what the rail hangs off.
    await expect(scroller.locator('[data-md-verdict="needs-work"]')).toHaveCount(1);

    // 4. A reload re-reads it from the database. The tab is reopened explicitly:
    // what is under test is persistence of the MARK, not of the open tab.
    await page.reload();
    await openNotes(page);
    await expect(scroller).toContainText('Release notes', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Review this document' }).click();
    await expect(scroller.locator('[data-md-verdict="needs-work"]')).toHaveCount(1, { timeout: 15_000 });

    // 5. Sending prefills the composer and does not submit it.
    await page.getByRole('button', { name: /send to chat/i }).click();
    const composerInput = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(composerInput).toHaveValue(/\[Review dokumen\] docs\/NOTES\.md/, { timeout: 10_000 });
    await expect(composerInput).toHaveValue(/needs work: basi setelah/);

    workspace.dispose();
  });

  test('an edit to a judged block reports it as outdated instead of losing the note', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-review-outdated');
    const filePath = join(workspace.path, 'NOTES.md');
    writeFileSync(filePath, DOCUMENT);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openRootDocument(page, 'NOTES.md');

    const scroller = page.locator(`[data-testid="${TESTID.editorScroller}"]`);
    await expect(scroller).toContainText('Release notes', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Review this document' }).click();

    await scroller.getByText('The first paragraph is fine as it stands.').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/what is wrong/i).fill('keep this');
    await dialog.getByRole('button', { name: 'Good' }).click();
    await expect(scroller.locator('[data-md-verdict="good"]')).toHaveCount(1);

    // Rewrite the judged paragraph on disk. Its text changed, so its anchor
    // cannot match anything the render produces.
    writeFileSync(filePath, DOCUMENT.replace(
      'The first paragraph is fine as it stands.',
      'The first paragraph was rewritten completely.',
    ));
    await page.reload();
    await openRootDocument(page, 'NOTES.md');
    await expect(scroller).toContainText('rewritten completely', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Review this document' }).click();

    // Shown, not dropped: the note is still the user's only copy.
    await expect(page.getByText(/1 outdated/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('keep this', { exact: false })).toBeVisible();

    workspace.dispose();
  });
});
