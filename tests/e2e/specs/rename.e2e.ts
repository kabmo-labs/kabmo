/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Rename with AI", driven against a real spawned child.
 *
 * The action is a model call of a few seconds behind a menu item that closes on
 * click, so the two things a user needs from it are exactly the two things a
 * unit test cannot prove: that the wait is VISIBLE while it runs, and that the
 * outcome is stated when it lands. Both were missing — the request was silent,
 * a second click fired a second generation, and a successful rename left no
 * trace beyond a title quietly changing.
 *
 * The spinner is asserted by ROLE and NAME, not by a class or a testid: it is
 * the surface's own accessible label that has to survive a refactor, and the
 * `⋯` menu is addressed the same way the app's other icon-only controls are.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('rename with AI', () => {
  test('spins while generating and reports the name it produced', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-rename-ai');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-rename-ai').first()).toBeVisible();

    // A real session first: `new-…` has no transcript to derive a title from,
    // and the menu deliberately hides the item for one.
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('name me');
    await input.press('Enter');
    await expect(page.getByText('Response to: name me').first()).toBeVisible({ timeout: 30_000 });

    // The session's own row menu, in the sidebar. The navbar's identical menu
    // only exists for a session the sidebar list has already scanned, and a
    // just-created session is still a client-side placeholder row there — so
    // the row is the surface that always has the action.
    await page.locator('aside').getByRole('button', { name: 'Session actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Rename with AI' }).click();

    // The wait is on screen. Both the row's slot and the header draw it, from
    // one store, so this asserts the contract between them rather than one
    // surface's private flag.
    await expect(page.getByRole('status', { name: /generating a/i }).first()).toBeVisible();

    // The fixture holds the answer for 600ms, so the spinner must be GONE once
    // the outcome lands — a mark left armed is a row that spins forever.
    await expect(page.getByText('Renamed to "Fake session".')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('status', { name: /generating a/i })).toHaveCount(0);

    // And the title the child reported is on screen, which is what the user
    // asked for in the first place.
    await expect(page.getByText('Fake session').first()).toBeVisible();

    workspace.dispose();
  });
});
