/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repo picker: ONE shared selection across the browsing panels.
 *
 * The picker was moved into `@ompchamber/ui` so a plugin panel and the host's
 * own panels draw the same control, and this spec is what proves the move kept
 * the behaviour a unit test cannot reach:
 *
 * - **Every browsing panel renders the kit component.** The desktop stack keeps
 *   all of them MOUNTED and hides the inactive ones with CSS, so a spec that
 *   addressed the picker globally would match four and pass even if the panel it
 *   meant had lost its own. Each assertion is scoped to the VISIBLE instance.
 * - **A pick in one panel moves the others.** The choice lives in one session
 *   slot (`workspace.activeRepo`); a second copy anywhere would show the old repo
 *   in the panel beside it, which is exactly the drift the shared slot prevents.
 *   This needs two mounted panels, a real socket and a real discovery walk.
 * - **The root row is labelled by the workspace's own directory name**, which is
 *   the last segment of the project PATH — not the display name the sidebar
 *   shows. The two differ in this fixture on purpose.
 *
 * A `real`-mode server: the discovery walk runs server-side and the list arrives
 * over the `repos:<root>` topic, so mock mode's fixed dataset cannot exercise it.
 *
 * The trigger is operated by KEYBOARD where a click is needed. At the width the
 * right panel opens, the activity bar overlaps the toolbar's trailing edge, so a
 * pointer click on the picker is refused as intercepted; focus + Enter is the
 * same interaction on the same control and is not a geometry question.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { test, expect, openApp, skipOnWindows } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** The visible picker trigger — one per on-screen panel. */
function picker(page: Page) {
  return page.locator('button[title="Switch git project"]:visible');
}

test.describe('repo picker', () => {
  test('every browsing panel renders the kit picker', async ({ harness, page }) => {
    skipOnWindows('builds nested repositories with a shell fixture');
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-repo-picker');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // The root row reads the workspace DIRECTORY's name, which is the last
    // segment of the path rather than the folder's display name.
    const rootName = workspace.path.split('/').filter(Boolean).pop()!;

    for (const panel of ['Files', 'Search', 'Source Control']) {
      await page.getByRole('button', { name: panel }).click();
      const visible = picker(page);
      await expect(visible).toHaveCount(1);
      // The kit component's contract: a trigger that announces a listbox.
      await expect(visible).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(visible).toContainText(rootName);
    }

    workspace.dispose();
  });

  test('a pick in one panel moves the others', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-repo-sync');

    // A nested repo, made by hand: a `.git` directory is all the walk looks for.
    const nested = join(workspace.path, 'projects', 'alpha');
    mkdirSync(join(nested, '.git'), { recursive: true });
    writeFileSync(join(nested, 'README.md'), '# alpha\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Files' }).click();

    const trigger = picker(page);
    await trigger.focus();
    await page.keyboard.press('Enter');

    // The nested repo appears once discovery's walk lands and the topic pushes.
    const option = page.locator('[role="option"]:visible', { hasText: 'projects/alpha' });
    await expect(option).toBeVisible({ timeout: 20_000 });
    await option.focus();
    await page.keyboard.press('Enter');

    // The trigger names the nested repo by its last segment (the short form).
    await expect(trigger).toContainText('alpha');

    // The panel beside it agrees — one shared slot, not a private copy.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(picker(page)).toContainText('alpha');

    workspace.dispose();
  });
});
