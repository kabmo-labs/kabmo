/**
 * @license
 * SPDX-License-Identifier: MIT
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

  test('New Session opens the empty workspace on a clean URL', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-sidebar-switch');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-sidebar-switch').first()).toBeVisible();

    // The primary action opens the LANDING: no `sessionId`, no `folderId`. It
    // used to mint a pending `new-…` chat that inherited the open session, so
    // the URL named a chat and the sidebar grew a row before anything was
    // chosen. Nothing has been chosen on a landing — that is the point.
    await page.getByRole('button', { name: /^new session$/i }).first().click();
    await expect(page).toHaveURL(new URL('/', server.baseURL).href);
    await expect(page.locator(`[data-testid="${TESTID.composerInput}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="session-item"][data-session-id^="new-"]')).toHaveCount(0);

    workspace.dispose();
  });

  test('a new chat in a WORKSPACE still mints a pending row', async ({ harness, page }) => {
    // The folder `+` is a different action: it chooses a context up front, so
    // its chat is named and its draft row exists from the first click. Only the
    // sidebar's primary action is the landing.
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    const firstItem = page.locator('[data-testid="session-item"]').first();
    await expect(firstItem).toBeVisible();
    const otherId = await firstItem.getAttribute('data-session-id');
    expect(otherId).toBeTruthy();

    await page.getByRole('button', { name: /^new session in /i }).first().click();
    const pendingId = new URL(page.url()).searchParams.get('sessionId') ?? '';
    expect(pendingId.startsWith('new-')).toBe(true);
    expect(pendingId).not.toBe(otherId);

    const pending = page.locator(`[data-testid="session-item"][data-session-id="${pendingId}"]`);
    await expect(pending).toBeVisible();

    await page.locator(`[data-testid="session-item"][data-session-id="${otherId}"]`).click();
    await expect(pending).toHaveCount(0);
  });

  test('a new chat with a TYPED draft keeps its row across the switch', async ({ harness, page }) => {
    // The other half of the same rule, and the one the row exists for: the
    // draft lives in that session's UI state, so the row is the only way back
    // to it. A regression here silently strands the user's text.
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    // Open a real session FIRST, so the workspace `+` inherits its folder and
    // the composer is enabled — the draft is what this spec is about.
    const firstItem = page.locator('[data-testid="session-item"]').first();
    await expect(firstItem).toBeVisible();
    const otherId = await firstItem.getAttribute('data-session-id');
    expect(otherId).toBeTruthy();
    await firstItem.click();

    await page.getByRole('button', { name: /^new session in /i }).first().click();
    const pendingId = new URL(page.url()).searchParams.get('sessionId') ?? '';
    expect(pendingId.startsWith('new-')).toBe(true);

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeEnabled();
    await input.fill('draft yang belum dikirim');

    const pending = page.locator(`[data-testid="session-item"][data-session-id="${pendingId}"]`);
    await page.locator(`[data-testid="session-item"][data-session-id="${otherId}"]`).click();
    await expect(pending).toBeVisible();

    // And the row is a way BACK: reopening it restores what was typed.
    await pending.click();
    await expect(page.locator(`[data-testid="${TESTID.composerInput}"]`)).toHaveValue('draft yang belum dikirim');
  });

  test('the app root is present and the sidebar is rendered', async ({ app }) => {
    await expect(app.locator(`[data-testid="${TESTID.appRoot}"]`)).toBeVisible();
    await expect(app.getByRole('button', { name: /new session/i }).first()).toBeVisible();
  });
});
