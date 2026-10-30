/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Batch archive, through the assembled product.
 *
 * The unit layer pins the rules (the bar draws Archive only in session mode,
 * the route is idempotent and refuses a pending chat); this layer pins the
 * thing a user actually operates: select a row, Archive, and watch exactly that
 * row leave the current list for the archive view — with one summary toast and
 * no confirmation dialog, because archiving is reversible.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';

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

/**
 * Enter workspace batch mode. The control lives on the toolbar row when it
 * fits and in the `⋯` menu when it does not — the sidebar is resizable, so the
 * spec must not assume either (same helper as `batch-delete.e2e.ts`).
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

/**
 * Toggle the sidebar's archive view. Like Select, the control lives on the
 * toolbar row when it fits and in the `⋯` menu when it does not.
 */
async function toggleArchiveView(page: Page, label: 'Show Archive' | 'Hide Archive') {
  const onRow = page.getByRole('button', { name: label, exact: true });
  if (await onRow.count() > 0) {
    await onRow.click();
    return;
  }
  await page.getByRole('button', { name: 'More sidebar actions' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test.describe('sidebar batch archive', () => {
  test('archiving one selected session moves exactly that row to the archive view', async ({ harness, page }) => {
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    const folderName = await firstFolderName(page);
    const rows = page.locator('[data-testid="session-item"]');
    await expect(rows.first()).toBeVisible();
    const rowsBefore = await rows.count();
    expect(rowsBefore).toBeGreaterThan(0);

    await startSessionSelection(page, folderName);

    // Archive is a session verb: the bar draws it here, refused until a row is
    // ticked — the same guard Delete has.
    await expect(page.getByTestId('batch-action-bar')).toContainText('sessions');
    await expect(page.getByRole('button', { name: /^Archive sessions$/ })).toBeDisabled();

    // Select ONE row and archive it. No dialog: the toast is the report.
    await page.locator('aside input[type="checkbox"]').nth(1).click();
    await expect(page.getByTestId('batch-action-bar')).toContainText('1 of');
    await page.getByRole('button', { name: 'Archive 1 session' }).click();

    await expect(page.getByText('Archived 1 session.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The mode ends and the row leaves the normal list.
    await expect(page.getByTestId('batch-action-bar')).toHaveCount(0);
    await expect(rows).toHaveCount(rowsBefore - 1);

    // It is not gone — it moved to the archive view, and it is the only row
    // there (the mock seed archives nothing).
    await toggleArchiveView(page, 'Show Archive');
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(1);
  });

  test('workspace mode draws no Archive control', async ({ harness, page }) => {
    const server = await harness('mock');
    await openApp(page, server.baseURL);

    await expect(page.getByRole('button', { name: /^Options for / }).first()).toBeVisible();
    await enterWorkspaceSelection(page);

    await expect(page.getByTestId('batch-action-bar')).toContainText('workspaces');
    await expect(page.getByRole('button', { name: /^Archive / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete workspaces$/ })).toBeVisible();
  });
});
