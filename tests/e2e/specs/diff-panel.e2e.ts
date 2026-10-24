/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff panel's two orthogonal toggles, on CodeMirror's merge view.
 *
 * The panel used to render git's unified patch as two hand-built tables, and
 * "Diff Only" / "Full Code" was a server flag (`fullContext=1` → `-U<large>`).
 * Both views now come from `@codemirror/merge`, which compares two DOCUMENTS, so
 * the toggles are client-side: the shape is a re-mount (an `EditorView` vs a
 * `MergeView`) and the amount is a `collapseUnchanged` reconfigure.
 *
 * Two facts are only visible assembled. A collapsed gap is a real widget the
 * extension draws (`.cm-collapsedLines`), and the counts must describe the rows
 * on screen — git's own `+n/-n` still counts a change the reader asked to hide.
 *
 * The repository is a real one: a working-tree change is what the panel reads,
 * and a fixture row would skip the route that computes the diff.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { seedWorkingRepo } from '../fixtures/git-repo';

function diffPanel(page: Parameters<typeof openApp>[0]) {
  return page.locator('[data-panel-id="editor-panel"]');
}

/** A file with two separated edits, so "collapsed" and "full" differ visibly. */
function longFile(): string {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
  lines[4] = 'line 5 changed';
  lines[74] = 'line 75 changed';
  return lines.join('\n');
}

async function seedRepo(page: Parameters<typeof openApp>[0], server: Parameters<typeof seedWorkspace>[0]) {
  const workspace = await seedWorkspace(server, 'e2e-diff-view');
  const repo = seedWorkingRepo('diff-view');
  repo.git('init', '-q', '-b', 'main');
  writeFileSync(join(repo.path, 'a.txt'), Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n'));
  repo.git('add', '.');
  repo.git('commit', '-qm', 'init');
  writeFileSync(join(repo.path, 'a.txt'), longFile());

  const folder = (await fetch(`${server.baseURL}/api/folders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'diff-view', path: repo.path }),
  }).then((response) => response.json())) as { folder?: { id: number | string } };

  await openApp(page, `${server.baseURL}/?folderId=${folder.folder?.id ?? workspace.id}`);
  return { workspace, repo };
}

async function openDiff(page: Parameters<typeof openApp>[0]) {
  await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  const right = page.locator('[data-panel-id="right-panel"]');
  const row = right.getByText('a.txt', { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  const panel = diffPanel(page);
  await expect(panel.locator('.cm-mergeView, .cm-editor').first()).toBeVisible({ timeout: 15_000 });
  return panel;
}

test.describe('diff panel views', () => {
  test('Unified collapses the unchanged stretches and Full Code expands them', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    // Diff Only is the default: the two edits are separated by 69 unchanged
    // lines, which the extension draws as ONE collapsed marker.
    const collapsed = panel.locator('.cm-collapsedLines');
    await expect(collapsed.first()).toBeVisible({ timeout: 10_000 });
    const markers = await collapsed.count();

    await panel.getByRole('button', { name: 'Full code (whole file, changes marked)' }).click();
    // The gap is a real range again, so the marker is gone.
    await expect(collapsed).toHaveCount(0, { timeout: 10_000 });
    expect(markers).toBeGreaterThan(0);

    // And back: the reconfigure is a compartment, not a re-mount.
    await panel.getByRole('button', { name: 'Diff only (changed hunks)' }).click();
    await expect(collapsed.first()).toBeVisible({ timeout: 10_000 });

    workspace.dispose();
  });

  test('Split draws two aligned editors for the same pair', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    await panel.getByRole('button', { name: 'Split (side-by-side) diff' }).click();
    // A `MergeView`, not a second `EditorView`: two editors in one element.
    await expect(panel.locator('.cm-mergeView')).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('.cm-editor')).toHaveCount(2, { timeout: 10_000 });
    // Both sides are READERS: the toolbar owns the writes.
    await expect(panel.locator('.cm-content[contenteditable="false"]')).toHaveCount(2, { timeout: 10_000 });

    // The old side carries the pre-edit line, the new side the edit.
    const text = await panel.locator('.cm-mergeView').innerText();
    expect(text).toContain('line 5');
    expect(text).toContain('line 5 changed');

    workspace.dispose();
  });

  test('the change counts describe the rows on screen', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    // Two one-line edits: one addition and one deletion each.
    await expect(panel.getByText('+2', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('-2', { exact: true })).toBeVisible({ timeout: 10_000 });

    workspace.dispose();
  });

  test('each shape remembers its own scroll position', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    // Full Code, because the collapsed default has no scroll range at all —
    // which is itself the proof that the collapse is real.
    await panel.getByRole('button', { name: 'Full code (whole file, changes marked)' }).click();
  test('a changed token carries no underline, and the row band still does', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    // `@codemirror/merge` marks the changed characters and its own base theme
    // paints a 2px gradient along the bottom of each fragment. That reads as a
    // broken baseline under the code, so `tailwind.css` suppresses it — and the
    // suppression has to win against a (0,3,0) rule the package mounts later.
    //
    // Asserted on the COMPUTED style, not on our rule's presence: a package bump
    // that reintroduces the bar still leaves our selector in the sheet.
    const changed = panel.locator('.cm-changedText').first();
    await expect(changed).toBeVisible({ timeout: 10_000 });
    const background = await changed.evaluate((node) => {
      const style = getComputedStyle(node);
      return { image: style.backgroundImage, size: style.backgroundSize };
    });
    expect(background.image).toBe('none');
    // `100% 2px` is the bar's own geometry; it must be gone with the image.
    expect(background.size).not.toBe('100% 2px');

    // The row band is the signal that remains, and the diff is unreadable
    // without it — so this asserts both directions rather than only the removal.
    const band = panel.locator('.cm-changedLine').first();
    await expect(band).toBeVisible();
    const bandBackground = await band.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(bandBackground).not.toBe('rgba(0, 0, 0, 0)');

    workspace.dispose();
  });

    const scroller = panel.getByTestId('diff-scroller');
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 10_000 })
      .toBeGreaterThan(200);

    await scroller.evaluate((el) => {
      el.scrollTop = 150;
      el.dispatchEvent(new Event('scroll'));
    });
    const leftAt = await scroller.evaluate((el) => el.scrollTop);
    expect(leftAt).toBeGreaterThan(100);

    // Split is a different row shape with its own offset; coming back to
    // Unified must restore the one it was left at.
    await panel.getByRole('button', { name: 'Split (side-by-side) diff' }).click();
    await expect(panel.locator('.cm-mergeView')).toBeVisible({ timeout: 10_000 });
    await panel.getByRole('button', { name: 'Unified diff' }).click();
    await expect
      .poll(async () => panel.getByTestId('diff-scroller').evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBe(leftAt);

    workspace.dispose();
  });

  test('word wrap keeps the panel from scrolling sideways', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    const scroller = panel.getByTestId('diff-scroller');
    await expect(scroller).toBeVisible({ timeout: 10_000 });
    // Wrapped is the default, so a 320px panel holds the longest line.
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), { timeout: 10_000 })
      .toBe(true);

    workspace.dispose();
  });
});
