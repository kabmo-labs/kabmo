/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's two chromes, from the user's side.
 *
 * The unit tests pin the resolver and the row contract; what only a browser can
 * answer is whether the SETTING reaches the sidebar: the style is written to
 * `kabmo_settings`, read back through the bootstrap on the next load, and the
 * column behind the settings modal redraws without a reload. Those are the three
 * ways this feature can be wrong while every unit test is green.
 *
 * The seed is the app's own write path (`POST /api/settings`, the same one the
 * modal uses), never a database insert — a spec that hand-wrote the row would
 * test a state the app cannot produce.
 */

import { test, expect } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

async function setSidebarStyle(baseURL: string, style: 'classic' | 'modern'): Promise<void> {
  const response = await fetch(`${baseURL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kabmo_settings: { sidebarStyle: style } }),
  });
  if (!response.ok) {
    throw new Error(`setSidebarStyle failed: ${response.status} ${await response.text()}`);
  }
}

test.describe('sidebar style', () => {
  test('the default is classic: a fresh install draws the shipped chrome', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-style-default');

    await page.goto(`${server.baseURL}/?folderId=${workspace.id}`);
    const sidebar = page.locator('aside').first();
    await expect(sidebar.getByText('e2e-style-default').first()).toBeVisible();

    // The classic chrome has no permanent search field; search is a mode there.
    await expect(sidebar.locator('input[type="search"]')).toHaveCount(0);
    // New Session is the toolbar's labelled primary action in that chrome.
    await expect(sidebar.getByRole('button', { name: 'New Session' }).first()).toBeVisible();

    workspace.dispose();
  });

  test('modern draws the permanent search field and the focus chips', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-style-modern');
    await setSidebarStyle(server.baseURL, 'modern');

    await page.goto(`${server.baseURL}/?folderId=${workspace.id}`);
    const sidebar = page.locator('aside').first();

    // The workspace name is the row the seed created; the chrome around it is
    // what changed.
    await expect(sidebar.getByText('e2e-style-modern').first()).toBeVisible();
    await expect(sidebar.locator('input[type="search"]')).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Running' })).toBeVisible();

    workspace.dispose();
  });

  test('the choice persists across a reload', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-style-persist');
    await setSidebarStyle(server.baseURL, 'modern');

    await page.goto(`${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.locator('aside').first().locator('input[type="search"]')).toBeVisible();

    await page.reload();
    await expect(page.locator('aside').first().locator('input[type="search"]')).toBeVisible();

    // And back: the classic chrome returns, so the setting is a choice rather
    // than a one-way migration.
    await setSidebarStyle(server.baseURL, 'classic');
    await page.reload();
    await expect(page.locator('aside').first().locator('input[type="search"]')).toHaveCount(0);

    workspace.dispose();
  });

  test('modern keeps the workspace actions the classic chrome offers', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-style-actions');
    await setSidebarStyle(server.baseURL, 'modern');

    await page.goto(`${server.baseURL}/?folderId=${workspace.id}`);
    const sidebar = page.locator('aside').first();

    // The two ways into a workspace's own actions, by name: the seed's folder
    // must offer both in the new chrome, or the style is a downgrade.
    await sidebar.getByRole('button', { name: 'New session in e2e-style-actions' }).click();
    await expect(page).toHaveURL(/sessionId=new-/);

    await sidebar.getByRole('button', { name: 'Options for e2e-style-actions' }).click();
    await expect(page.getByText('Select sessions')).toBeVisible();
    await expect(page.getByText('Delete Workspace')).toBeVisible();

    workspace.dispose();
  });
});
