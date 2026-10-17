/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Workspace dialog: the folder listing with its refresh and new-folder
 * controls, and the git-clone tab.
 *
 * These are the four controls that only exist in the assembled product. A unit
 * test can render the modal, but it cannot see that a refresh actually re-read
 * `/api/fs/browse`, that a mkdir lands in the directory the LISTING is showing,
 * or that a clone exits 0 and the reload brings the new workspace into the
 * sidebar — the failure modes all live in the wiring between the dialog, the
 * route and the filesystem.
 *
 * Two rules from the layer's own history are applied here. A wait is always on
 * the CONDITION the action needs, never a duration: the refresh is awaited on
 * the listing's own response, and the clone on the sidebar row appearing. And
 * the assertion is on the OBSERVABLE that changed — the row in the listing, the
 * workspace in the sidebar — never on the button that was clicked.
 *
 * The parent directory is a temp tree the spec owns, so a case can never write
 * into the developer's own `~/projects`; the git source is a real repository
 * made by `seedRepo`, because the route shells out to the real `git`.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openApp, skipOnWindows } from '../fixtures/app';
import { seedCloneParent, seedRepo } from '../fixtures/git-repo';

/** Open the dialog from the sidebar toolbar and wait for its heading. */
async function openNewWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New Workspace' }).first().click();
  await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeVisible();
}

/** Type a path into the location field and commit it (the form's own Enter). */
async function goToPath(page: Page, target: string): Promise<void> {
  const field = page.getByLabel('Project path');
  await field.fill(target);
  await field.press('Enter');
}

test.describe('new workspace dialog', () => {
  test('lists a directory and creates a folder in it', async ({ harness, page }) => {
    const server = await harness('real');
    const parent = seedCloneParent('mkdir');
    await openApp(page, server.baseURL);
    await openNewWorkspace(page);

    await goToPath(page, parent.path);
    // An empty listing is itself the proof the path took effect.
    await expect(page.getByText('No subfolders')).toBeVisible();

    await page.getByRole('button', { name: 'New folder here' }).click();
    const nameField = page.getByLabel('New folder name');
    await nameField.fill('made-in-browser');
    await nameField.press('Enter');

    // The folder was CREATED, not selected: the dialog stays on the parent and
    // the listing gains the row.
    await expect(page.getByRole('button', { name: 'made-in-browser' })).toBeVisible();

    parent.dispose();
  });

  test('refresh picks up a folder created outside the dialog', async ({ harness, page }) => {
    const server = await harness('real');
    const parent = seedCloneParent('refresh');
    await openApp(page, server.baseURL);
    await openNewWorkspace(page);

    await goToPath(page, parent.path);
    await expect(page.getByText('No subfolders')).toBeVisible();

    // Written behind the dialog's back — the only way to prove the button
    // re-reads rather than re-rendering what it already had.
    mkdirSync(join(parent.path, 'appeared-later'));

    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/fs/browse' && response.status() === 200,
    );
    await page.getByRole('button', { name: 'Refresh folders' }).click();
    await refreshed;

    await expect(page.getByRole('button', { name: 'appeared-later' })).toBeVisible();

    parent.dispose();
  });

  test('refuses a folder name that already exists', async ({ harness, page }) => {
    const server = await harness('real');
    const parent = seedCloneParent('dupe');
    mkdirSync(join(parent.path, 'taken'));

    await openApp(page, server.baseURL);
    await openNewWorkspace(page);
    await goToPath(page, parent.path);
    await expect(page.getByRole('button', { name: 'taken' })).toBeVisible();

    await page.getByRole('button', { name: 'New folder here' }).click();
    const nameField = page.getByLabel('New folder name');
    await nameField.fill('taken');
    await nameField.press('Enter');

    // Reported inline, and the inline field stays open so the name can be
    // corrected — a refusal that closed the field would read as success.
    await expect(page.getByText('taken already exists')).toBeVisible();
    await expect(nameField).toBeVisible();

    parent.dispose();
  });

  test('the clone button is disabled until the URL is one git accepts', async ({ harness, page }) => {
    const server = await harness('real');
    await openApp(page, server.baseURL);
    await openNewWorkspace(page);

    await page.getByRole('button', { name: 'Clone', exact: true }).click();
    const cloneButton = page.getByRole('button', { name: 'Clone repository' });
    await expect(cloneButton).toBeDisabled();

    // The hint is the destination preview, so it also proves the slug rule.
    await page.getByLabel('Git repository URL').fill('https://github.com/org/thing.git');
    await expect(cloneButton).toBeEnabled();
    await expect(page.getByText(/Creates workspace .*thing/)).toBeVisible();
  });

  test('clones a repository and the new workspace appears in the sidebar', async ({ harness, page }) => {
    skipOnWindows('clones a repository into a temp workspace');
    const server = await harness('real');
    const origin = seedRepo('clone-origin');
    const parent = seedCloneParent('clone-into');
    await openApp(page, server.baseURL);
    await openNewWorkspace(page);

    await goToPath(page, parent.path);
    await page.getByRole('button', { name: 'Clone', exact: true }).click();
    await page.getByLabel('Git repository URL').fill(origin.url);

    await page.getByRole('button', { name: 'Clone repository' }).click();

    // The route clones, registers, and the client reloads; the observable is
    // the workspace in the sidebar, which is what the reload was for.
    await expect(page.getByText(origin.slug, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeHidden();

    origin.dispose();
    parent.dispose();
  });

  test('surfaces a failed clone without closing the dialog', async ({ harness, page }) => {
    skipOnWindows('clones a repository into a temp workspace');
    const server = await harness('real');
    const parent = seedCloneParent('clone-fail');
    await openApp(page, server.baseURL);
    await openNewWorkspace(page);

    await goToPath(page, parent.path);
    await page.getByRole('button', { name: 'Clone', exact: true }).click();
    await page.getByLabel('Git repository URL').fill(`${parent.path}/no-such-repo`);
    await page.getByRole('button', { name: 'Clone repository' }).click();

    // git's own message, surfaced verbatim — not a generic failure.
    await expect(page.getByText(/does not exist|not found/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeVisible();

    parent.dispose();
  });
});
