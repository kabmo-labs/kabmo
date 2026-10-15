/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar: the workspace list, the settings entry, and session switching.
 *
 * These are the surfaces every other spec builds on — a spec that cannot open
 * a session cannot test anything below the shell — and they are also where an
 * accessibility regression is invisible to a unit test: the footer's Settings
 * and Info controls were bare `<svg onClick>` glyphs until this spec needed to
 * address them, which is exactly the "unreachable by keyboard" shape AGENTS.md
 * warns about. The spec addresses them by ROLE and NAME, so the day one loses
 * its name the spec fails rather than silently clicking a different glyph.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('sidebar', () => {
  test('lists a seeded workspace folder', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-sidebar-list');

    await openApp(page, server.baseURL);
    await expect(page.getByText('e2e-sidebar-list').first()).toBeVisible();

    workspace.dispose();
  });

  test('opens the settings modal from the footer', async ({ app }) => {
    // The footer's Settings control is a button with an accessible name — this
    // is the assertion that keeps it one.
    await app.getByRole('button', { name: 'Settings' }).first().click();
    await expect(app.getByRole('button', { name: 'Close settings' })).toBeVisible();
    // The modal renders the category rail; Appearance is a stable entry.
    await expect(app.getByRole('button', { name: 'Appearance' })).toBeVisible();
  });

  test('creates a new session and switches the active one', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-sidebar-switch');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-sidebar-switch').first()).toBeVisible();

    // New Session opens a pending `new-…` chat; the URL carries it, which is
    // the observable the switch depends on.
    await page.getByRole('button', { name: /new session/i }).first().click();
    await expect(page).toHaveURL(/sessionId=new-/);

    workspace.dispose();
  });

  test('a new chat keeps its sidebar row when the user switches away', async ({ harness, page }) => {
    // A brand-new chat has no transcript yet — omp writes the session file only
    // when the first assistant message settles (~17s) — so its row exists only
    // because the client draws it. The row used to be derived from
    // `?sessionId=`, which meant clicking another session deleted it and it
    // reappeared seconds later once omp's scan caught up.
    //
    // Mounted on the `page` fixture rather than `app`: the demo session ids the
    // mock seed writes have no mode record, so clicking one makes the chat's
    // own `/api/sessions/:id/modes` probe answer 404 — a pre-existing console
    // error unrelated to the list, and one `app`'s no-errors assertion fails on.
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    // The session to switch TO is addressed by its own id, never by `.first()`:
    // the pending row is injected at the TOP of its folder, so a positional
    // locator resolves to that row at click time and the click would re-select
    // the pending chat — a spec that passes with the bug still in place.
    const firstItem = page.locator('[data-testid="session-item"]').first();
    await expect(firstItem).toBeVisible();
    const otherId = await firstItem.getAttribute('data-session-id');
    expect(otherId).toBeTruthy();

    await page.getByRole('button', { name: /^new session$/i }).first().click();
    const pendingId = new URL(page.url()).searchParams.get('sessionId') ?? '';
    expect(pendingId.startsWith('new-')).toBe(true);
    expect(pendingId).not.toBe(otherId);

    const pending = page.locator(`[data-testid="session-item"][data-session-id="${pendingId}"]`);
    await expect(pending).toBeVisible();

    await page.locator(`[data-testid="session-item"][data-session-id="${otherId}"]`).click();
    await expect(pending).toBeVisible();
  });

  test('the app root is present and the sidebar is rendered', async ({ app }) => {
    await expect(app.locator(`[data-testid="${TESTID.appRoot}"]`)).toBeVisible();
    await expect(app.getByRole('button', { name: /new session/i }).first()).toBeVisible();
  });
});
