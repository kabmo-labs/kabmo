/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel on a phone: a long press opens the row's menu, and does not
 * select the panel's text.
 *
 * The reported bug was exactly this, and neither half is visible to a unit test.
 * Every row is a drag SOURCE, so a long press started a native drag of the whole
 * panel and selected the tree's text, and no `contextmenu` ever reached the row
 * — the menu was unreachable by finger. The fix is the same gesture routed
 * through `useLongPress`: the native drag is dropped on a touch device, a press
 * that moves is a scroll, and the click the press produces is swallowed.
 *
 * Run under `mobile-chromium`, so `(pointer: coarse)` is the device's own answer
 * — which is the flag the panel branches on.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('mobile files panel', () => {
  test('a long press on a row opens its menu without selecting the tree', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-mobile-files');
    writeFileSync(join(workspace.path, 'notes.md'), '# notes\n');

    // `openApp` (never `goto`) installs the MOCK update popup's dismisser: it
    // opens over the app on every mock boot and its backdrop swallows clicks.
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Open Right Panel' }).click();
    // The drawer restores its last tab, and Files is the default.
    await page.getByRole('button', { name: 'Files' }).click();

    const row = page.getByText('notes.md', { exact: true });
    await expect(row).toBeVisible();

    // A real press: pointer down, hold past the threshold, release. Playwright's
    // `tap()` is too short, and a synthetic `contextmenu` would skip the very
    // gesture under test.
    const box = (await row.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // The menu is the row's own: Rename and Delete name a FILE, which is what
    // the long press was aimed at.
    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

    // The reported symptom: holding the row selected the whole panel instead.
    const selection = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selection).toBe('');
    // And the tree is not a native drag source on a finger, so the press cannot
    // become one. The attribute is present with the value `false` — `draggable`
    // is an enumerated attribute, so its PRESENCE proves nothing.
    const dragRow = row.locator('xpath=ancestor::*[@draggable][1]');
    await expect(dragRow).toHaveAttribute('draggable', 'false');
    // The flag that decides it: `useTouchDevice()` reported a coarse pointer,
    // which is also what put the tree's selection suppression in place.
    await expect(page.locator('.file-tree-touch')).toHaveCount(1);

    workspace.dispose();
  });

  test('a press that scrolls does not open a menu', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-mobile-files-scroll');
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(join(workspace.path, `file-${index}.md`), `# ${index}\n`);
    }

    // `openApp` (never `goto`) installs the MOCK update popup's dismisser: it
    // opens over the app on every mock boot and its backdrop swallows clicks.
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Open Right Panel' }).click();
    await page.getByRole('button', { name: 'Files' }).click();

    const row = page.getByText('file-0.md', { exact: true });
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    // Past the slop: the first pixels of a flick arrive at once, and a menu on
    // them would make the tree unscrollable.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y - 90 }],
    });
    await page.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toHaveCount(0);

    workspace.dispose();
  });
});
