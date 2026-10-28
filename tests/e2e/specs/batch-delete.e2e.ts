/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Batch delete, both modes, through the assembled product.
 *
 * The unit layer pins the rules (which ids a header offers, what a click does);
 * this layer pins the thing a user actually operates: that the checkboxes do
 * not exist until the mode is entered, that entering it from a workspace's own
 * menu scopes the selection to that workspace's rows, and that Delete really
 * removes what the bar counted.
 *
 * Two details are load-bearing and each is a way this feature reads as broken:
 * the toolbar's Select control can be in the `⋯` overflow on a narrow sidebar
 * (so the spec opens the menu when the row does not carry it), and a workspace
 * selection must NOT expand every folder — it selects folders, not rows.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { TESTID } from '../fixtures/selectors';

/**
 * Enter workspace batch mode. The control lives on the toolbar row when it
 * fits and in the `⋯` menu when it does not — and the sidebar is resizable, so
 * the spec must not assume either. The menu's rows are `role="menuitem"`.
 */
async function enterWorkspaceSelection(page: Page) {
  const onRow = page.getByRole('button', { name: 'Select workspaces' });
  if (await onRow.count() > 0) {
    await onRow.click();
    return;
  }
  await page.getByRole('button', { name: 'More sidebar actions' }).click();
  await page.getByRole('menuitem', { name: 'Select workspaces' }).click();
}

/** Open a workspace's `⋯` menu and click `Select sessions`. */
async function startSessionSelection(page: Page, folderName: string) {
  await page.getByRole('button', { name: `Options for ${folderName}` }).click();
  await page.getByRole('button', { name: 'Select sessions' }).click();
}

/** The sidebar's first workspace name, from its own `⋯` button. */
async function firstFolderName(page: Page): Promise<string> {
  const button = page.getByRole('button', { name: /^Options for / }).first();
  await expect(button).toBeVisible();
  return (await button.getAttribute('aria-label') ?? '').replace(/^Options for /, '');
}

test.describe('sidebar batch delete', () => {
  test('workspace mode draws a checkbox per workspace and deletes the selected ones', async ({ harness, page }) => {
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    await expect(page.getByRole('button', { name: /^Options for / }).first()).toBeVisible();
    const foldersBefore = await page.getByRole('button', { name: /^Options for / }).count();
    expect(foldersBefore).toBeGreaterThan(0);

    // No checkbox until the mode is entered.
    await expect(page.locator('aside input[type="checkbox"]')).toHaveCount(0);

    await enterWorkspaceSelection(page);

    const boxes = page.locator('aside input[type="checkbox"]');
    await expect(boxes).toHaveCount(foldersBefore);
    await expect(page.getByTestId('batch-action-bar')).toContainText(`0 of ${foldersBefore} workspaces`);

    // The bar's Delete is refused with nothing selected — the only guard
    // between a mode and an accidental wipe.
    await expect(page.getByRole('button', { name: /^Delete workspaces$/ })).toBeDisabled();

    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(page.getByTestId('batch-action-bar')).toContainText(`${foldersBefore} of ${foldersBefore}`);

    await page.getByRole('button', { name: `Delete ${foldersBefore} workspaces` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('The workspaces are removed from this sidebar.');
    await dialog.getByRole('button', { name: `Delete ${foldersBefore} workspaces` }).click();

    // The mode ends and the workspaces are gone from the list.
    await expect(page.getByTestId('batch-action-bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(0);
  });

  test('session mode from a workspace menu scopes the checkboxes to that workspace', async ({ harness, page }) => {
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    const folderName = await firstFolderName(page);
    expect(folderName).not.toBe('');

    const rowsInFolder = page.locator('[data-testid="session-item"]');
    await expect(rowsInFolder.first()).toBeVisible();
    const rowsBefore = await rowsInFolder.count();
    expect(rowsBefore).toBeGreaterThan(0);

    await startSessionSelection(page, folderName);

    // A header checkbox for the workspace plus one per row it offers — and no
    // checkbox on a row of any other workspace.
    const boxes = page.locator('aside input[type="checkbox"]');
    const boxCount = await boxes.count();
    expect(boxCount).toBeGreaterThan(1);
    await expect(page.getByTestId('batch-action-bar')).toContainText(`in ${folderName}`);

    // Ticking the header selects every row it offers.
    await page.locator(`aside input[type="checkbox"][aria-label="Select ${folderName}"]`).click();
    await expect(page.getByTestId('batch-action-bar')).toContainText(`${boxCount - 1} of ${boxCount - 1} sessions`);

    // Unticking it clears them again — both directions exist.
    await page.getByRole('button', { name: 'Unselect all' }).click();
    await expect(page.getByTestId('batch-action-bar')).toContainText(`0 of ${boxCount - 1} sessions`);

    // Cancel leaves the mode and the list is untouched.
    await page.getByRole('button', { name: 'Cancel selection' }).click();
    await expect(page.getByTestId('batch-action-bar')).toHaveCount(0);
    await expect(boxes).toHaveCount(0);
    await expect(page.locator(`[data-testid="${TESTID.sessionItem}"]`)).toHaveCount(rowsBefore);
  });

  test('deleting selected sessions removes exactly those rows', async ({ harness, page }) => {
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    const folderName = await firstFolderName(page);

    await expect(page.locator('[data-testid="session-item"]').first()).toBeVisible();
    const rowsBefore = await page.locator('[data-testid="session-item"]').count();
    await startSessionSelection(page, folderName);

    // Select ONE row by its own checkbox and delete it.
    const firstRowBox = page.locator('aside input[type="checkbox"]').nth(1);
    await firstRowBox.click();
    await expect(page.getByTestId('batch-action-bar')).toContainText('1 of');
    await page.getByRole('button', { name: 'Delete 1 session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete 1 session' }).click();

    await expect(page.getByTestId('batch-action-bar')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(rowsBefore - 1);
  });
});
