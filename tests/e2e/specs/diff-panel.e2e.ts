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

async function seedRepo(
  page: Parameters<typeof openApp>[0],
  server: Parameters<typeof seedWorkspace>[0],
  extraFiles: Record<string, string> = {},
) {
  const workspace = await seedWorkspace(server, 'e2e-diff-view');
  const repo = seedWorkingRepo('diff-view');
  repo.git('init', '-q', '-b', 'main');
  writeFileSync(join(repo.path, 'a.txt'), Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n'));
  repo.git('add', '.');
  repo.git('commit', '-qm', 'init');
  writeFileSync(join(repo.path, 'a.txt'), longFile());
  // Written BEFORE the app opens, because the Source Control list is read on
  // mount: a file created afterwards would need a refresh the spec does not own.
  for (const [name, content] of Object.entries(extraFiles)) writeFileSync(join(repo.path, name), content);

  const folder = (await fetch(`${server.baseURL}/api/folders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'diff-view', path: repo.path }),
  }).then((response) => response.json())) as { folder?: { id: number | string } };

  await openApp(page, `${server.baseURL}/?folderId=${folder.folder?.id ?? workspace.id}`);
  return { workspace, repo };
}

/**
 * Click a toolbar control wherever it currently lives.
 *
 * The toolbar is ONE row and the tail moves into a `⋯` menu on a narrow panel
 * (the editor column opens at 320px, where ten-plus controls do not fit). A spec
 * that assumed a fixed position failed the moment a control crossed that line —
 * measured: `Full code` was on the row at a wide panel and behind `⋯` at the
 * floor. The control is the same control either way, so the lookup follows it.
 */
async function clickToolbar(page: Parameters<typeof openApp>[0], name: string): Promise<void> {
  const panel = diffPanel(page);
  const button = panel.getByRole('button', { name, exact: true });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  await panel.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function openDiff(page: Parameters<typeof openApp>[0], file = 'a.txt') {
  await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  const right = page.locator('[data-panel-id="right-panel"]');
  const row = right.getByText(file, { exact: true }).first();
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

    await clickToolbar(page, 'Full code (whole file, changes marked)');
    // The gap is a real range again, so the marker is gone.
    await expect(collapsed).toHaveCount(0, { timeout: 10_000 });
    expect(markers).toBeGreaterThan(0);

    // And back: the reconfigure is a compartment, not a re-mount.
    await clickToolbar(page, 'Diff only (changed hunks)');
    await expect(collapsed.first()).toBeVisible({ timeout: 10_000 });

    workspace.dispose();
  });

  test('Split draws two aligned editors for the same pair', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    await clickToolbar(page, 'Split (side-by-side) diff');
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
    await clickToolbar(page, 'Full code (whole file, changes marked)');
    const scroller = panel.getByTestId('diff-scroller');
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 10_000 })
      .toBeGreaterThan(200);

    await scroller.evaluate((el) => {
      // The input a reader's scroll starts with: the hook tells a person's
      // scroll from the browser's own re-anchoring by whether an input preceded
      // it, so a bare `scrollTop` assignment is undone as if the document had
      // corrected itself (measured: read back 0 where 150 was written).
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }));
      el.scrollTop = 150;
      el.dispatchEvent(new Event('scroll'));
    });
    const leftAt = await scroller.evaluate((el) => el.scrollTop);
    expect(leftAt).toBeGreaterThan(100);

    // Split is a different row shape with its own offset; coming back to
    // Unified must restore the one it was left at.
    await clickToolbar(page, 'Split (side-by-side) diff');
    await expect(panel.locator('.cm-mergeView')).toBeVisible({ timeout: 10_000 });
    await clickToolbar(page, 'Unified diff');
    await expect
      .poll(async () => panel.getByTestId('diff-scroller').evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBe(leftAt);

    workspace.dispose();
  });

  /**
   * The row must take the width the BAR gives it, not the width of what it is
   * currently showing.
   *
   * Measured before the fix: a 373px diff panel reported a **204px** row at every
   * viewport, so Unified/Split/Full Code lived in `⋯` on a 1440px screen — the
   * two view modes read as missing. The cause was a feedback loop: the row was
   * content-sized, so hiding a cluster shrank the row, which shrank `available`,
   * which hid another, and the row never grew back when the panel was widened.
   *
   * `clickToolbar` deliberately follows a control into the menu, so every other
   * spec in this file passed with the modes buried. This one asserts where they
   * are, because "one click away" is not the same as "on the row".
   */
  test('the toolbar row fills the panel, so the view modes stay on it', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    const geometry = await panel.evaluate((el) => {
      const bar = el.querySelector<HTMLElement>('div[class*="@container"]');
      const row = bar?.querySelector<HTMLElement>('div.flex-nowrap') ?? null;
      return {
        bar: bar?.clientWidth ?? 0,
        row: row?.clientWidth ?? 0,
        rowScroll: row?.scrollWidth ?? 0,
      };
    });

    expect(geometry.bar).toBeGreaterThan(300);
    // The bar's horizontal padding (px-3, both sides) is the only thing the row
    // may give up; a content-sized row gave up a third of it.
    expect(geometry.row).toBeGreaterThanOrEqual(geometry.bar - 32);
    // Nothing may be clipped out of the row either: a control past its right
    // edge is a control the reader cannot see.
    expect(geometry.rowScroll).toBeLessThanOrEqual(geometry.row + 1);

    // Both shapes of the diff are on the ROW at the panel's default width.
    await expect(panel.getByRole('button', { name: 'Unified diff', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Split (side-by-side) diff', exact: true })).toBeVisible();

    workspace.dispose();
  });

  /**
   * The `⋯` menu must be reachable by a POINTER, not only by Playwright.
   *
   * `getByRole('menuitem').click()` cannot catch this. The row is
   * `overflow-hidden`, which is still programmatically scrollable, so Playwright's
   * own `scrollRectIntoViewIfNeeded` scrolls the row until the menu row is under
   * the cursor and the click lands — measured: the menu reported
   * `isVisible: true` and a real click succeeded while `elementFromPoint` at its
   * own centre answered `.cm-content`, i.e. a `.cm-line` in the diff BEHIND it.
   * A person has no such scroll: every row was invisible and unclickable while
   * the trigger read `aria-expanded="true"`.
   *
   * So the assertion is the hit test itself — what the browser would dispatch a
   * press to — which is the only thing a pointer actually obeys.
   */
  test('the overflow menu is hit-testable, not clipped behind the diff', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server);
    const panel = await openDiff(page);

    // Make the row overflow so the trigger exists at all.
    await page.setViewportSize({ width: 900, height: 720 });
    await panel.getByRole('button', { name: 'More actions' }).click();

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 10_000 });

    const probe = await page.evaluate(() => {
      const el = document.querySelector('[role="menu"]') as HTMLElement | null;
      if (!el) return { found: false } as const;
      const rect = el.getBoundingClientRect();
      const points = [0.1, 0.5, 0.9].map((fraction) => {
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * fraction);
        return {
          fraction,
          inside: Boolean(hit && el.contains(hit)),
          hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null,
        };
      });
      // Nothing between the menu and the viewport may clip it.
      const clippedBy: string[] = [];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflow !== 'visible' || style.overflowY !== 'visible') {
          clippedBy.push(`${node.tagName}.${String(node.className).slice(0, 40)} ${style.overflowY}`);
        }
      }
      return { found: true, points, clippedBy, height: Math.round(rect.height) } as const;
    });

    expect(probe.found).toBe(true);
    if (!probe.found) return;
    // A menu is taller than one row, or the trigger had nothing to bury.
    expect(probe.height).toBeGreaterThan(60);
    // Every sampled point belongs to the menu — the whole point of the portal.
    expect(probe.points.map((point) => point.inside)).toEqual([true, true, true]);
    expect(probe.clippedBy).toEqual([]);

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

  /**
   * Folding and brace detection, on a real layout.
   *
   * Both halves depend on geometry the unit layer cannot produce: the gutter
   * marker has to have a box a press can land in, and the pair guide is drawn
   * from a measured column. happy-dom computes no layout, so `folding.test.ts`
   * pins the rule and the fold STATE while this spec proves the feature a
   * reader actually operates.
   */
  test('a brace block folds from the gutter, and the pair is detected', async ({ harness, page }) => {
    const server = await harness('real');
    const { workspace } = await seedRepo(page, server, {
      // A new file with a brace block: the diff shows it as additions, so every
      // row is on screen under the default "Diff only".
      'code.ts': [
        'function outer(a: number) {',
        '  const b = a + 1;',
        '  const c = b * 2;',
        '  return c;',
        '}',
        '',
      ].join('\n'),
    });
    const panel = await openDiff(page, 'code.ts');

    const marker = panel.locator('.cm-foldGutter .cm-gutterElement span[title="Fold line"]').first();
    await expect(marker).toBeVisible({ timeout: 10_000 });
    await marker.click();

    const placeholder = panel.locator('.cm-foldPlaceholder');
    await expect(placeholder).toBeVisible({ timeout: 10_000 });
    // The body is inside the fold, so its rows are not rendered at all.
    await expect(panel.locator('.cm-line', { hasText: 'const b = a + 1;' })).toHaveCount(0);

    await placeholder.click();
    await expect(panel.locator('.cm-line', { hasText: 'const b = a + 1;' })).toHaveCount(1);

    // Open/close detection: a caret beside the `{` paints both ends of the pair
    // and the guide down the rows between them.
    const brace = await panel.locator('.cm-line').first().evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        const index = text.indexOf('{');
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });
    expect(brace).not.toBeNull();
    if (!brace) return;
    await page.mouse.click(brace.x, brace.y);

    await expect
      .poll(async () => panel.locator('.cm-matchingBracket').count(), { timeout: 10_000 })
      .toBe(2);
    await expect
      .poll(async () => panel.locator('.cm-line.cm-bracket-guide').count(), { timeout: 10_000 })
      .toBe(3);

    workspace.dispose();
  });
});
