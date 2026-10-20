/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The right panel: switching views, and the per-session layout surviving a reload.
 *
 * The activity bar's buttons carry `aria-label={panel.title}` — the same title
 * the catalog declares — so the spec addresses a view by its name, which is
 * what a reader sees. The panel body is located through the resizer's own
 * `data-panel-id` (the layout's real identity), and the switch is proven by the
 * VIEW's own content appearing (a placeholder unique to it), never by a class.
 *
 * The persistence half is the one a unit test cannot reach: the panel choice
 * lives in `session_ui_state`, is posted on change and read back on load, and
 * the bug this catches is a panel that resets to `files` because a pending
 * session's state was never loaded.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('right panel', () => {
  test('switches the active view from the activity bar', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-panels');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    const rightPanel = page.locator('[data-panel-id="right-panel"]');
    await expect(rightPanel).toBeVisible();

    // Source Control's own content: the commit message box.
    await page.getByRole('button', { name: 'Source Control' }).click();
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    // Search's own content: its query field.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(rightPanel.getByPlaceholder('Search', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(/commit message/i)).toBeHidden();

    workspace.dispose();
  });

  test('the chosen view survives a reload', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-panels-persist');
    const url = `${server.baseURL}/?folderId=${workspace.id}`;
    await openApp(page, url);

    // The panel choice is persisted under a 600ms debounce
    // (`PERSIST_DEBOUNCE_MS`), so a reload issued right after the click races
    // the write and lands on the previous layout. Wait for the write itself —
    // a sleep would either be too short on a loaded runner or waste time on an
    // idle one.
    const persisted = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/sessions\/.+\/state$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole('button', { name: 'Source Control' }).click();
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();
    await persisted;

    await openApp(page, url);
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    workspace.dispose();
  });

  test('the panels opened in a NEW chat survive its first send', async ({ harness, page }) => {
    // The reported bug: click New Session, open a few right-panel views, send
    // the first prompt — and the panel collapsed back to its default, because
    // the spawn renames the session (`new-…` → omp UUID) and the adoption
    // migrates the pending slot AFTER every `useSessionState` copy had already
    // re-read the still-empty adopted one. The view is asserted by its own
    // content, the way a reader sees it.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-panels-adopt');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-panels-adopt').first()).toBeVisible();

    // The FOLDER's own New Session, not the toolbar's: the toolbar one inherits
    // the active session's folder, and a spec that opened the app with
    // `?folderId=` and clicked no session has none — the composer then stays
    // disabled ("Please select a workspace above") and the send never happens.
    // The pending slot's own blob must have LOADED before the panel click: the
    // provider only marks itself ready once that fetch settles, and while it is
    // in flight a later `ready` flip would mask the bug by re-reading the store
    // after the migration. Waiting on the response is the same condition the
    // panel restore itself depends on.
    const pendingStateLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /^\/api\/sessions\/new-.+\/state$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole('button', { name: /^new session$/i }).last().click();
    await expect(page).toHaveURL(/sessionId=new-/);
    await pendingStateLoaded;

    await page.getByRole('button', { name: 'Source Control' }).click();
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeEnabled();
    await input.fill('adopt me');
    await input.press('Enter');

    // The spawn answers with the real id; the panel must still be on the view
    // the user picked, with nothing re-clicked.
    await expect(page).toHaveURL(/sessionId=(?!new-)/, { timeout: 30_000 });
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    workspace.dispose();
  });

  test('collapsing and reopening the panel keeps the chosen view', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-panels-toggle');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    await page.getByRole('button', { name: 'Source Control' }).click();
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    // The navbar's toggle collapses the panel; toggling back must return to the
    // SAME view, not the default.
    const toggle = page.getByRole('button', { name: /toggle right panel/i });
    await toggle.click();
    await expect(page.locator('[data-panel-id="right-panel"]')).toBeHidden();
    await toggle.click();
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();

    workspace.dispose();
  });

  test('dragging a button reorders the bar, and the order survives a reload', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-panels-order');
    const url = `${server.baseURL}/?folderId=${workspace.id}`;
    await openApp(page, url);

    const buttons = page.locator('nav button[aria-label]');
    await expect(buttons.first()).toHaveAttribute('aria-label', 'Context & Telemetry');

    // The order is a GLOBAL setting, written on the drop itself (no session
    // debounce), so the write is the condition to wait on rather than a sleep.
    const persisted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/settings',
    );
    await page.getByRole('button', { name: 'Todos' }).dragTo(page.getByRole('button', { name: 'Context & Telemetry' }));
    await persisted;

    // Todos was dragged up onto Context, so it takes that slot and everything
    // else keeps its relative order.
    await expect(buttons.first()).toHaveAttribute('aria-label', 'Todos');

    // And the order is what the NEXT load draws — a per-session slot would not
    // survive a different session, which is why this is asserted after a reload.
    await openApp(page, url);
    await expect(page.locator('nav button[aria-label]').first()).toHaveAttribute('aria-label', 'Todos');

    workspace.dispose();
  });
});
