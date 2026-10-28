/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Panel plugins: install from a git URL, detect a newer commit, and update it —
 * through the real UI, against a real repository and a real server.
 *
 * This is the layer the bugs in this feature were found in. Three of them are
 * invisible to a unit test and each shipped:
 *
 * - the `gitStatus` map travels on the SCAN payload, which is cached for five
 *   seconds — so a probe whose result was written but whose cache was not
 *   invalidated rendered "not checked" for a plugin that had just been checked;
 * - the same for the auto-update flag, where the checkbox snapped back under the
 *   user's click;
 * - the freshness row is rendered from `gitOrigin`, which the scan derives from
 *   the plugin's own `.git` — a wrong derivation shows no row at all, which
 *   looks exactly like a plugin with nothing to update.
 *
 * The repository is a LOCAL git repo seeded into a temp directory, so the spec
 * needs no network and can advance the remote on demand.
 *
 * A `real`-mode server is used because the install path spawns `git` and the
 * probe runs `git ls-remote`; the mock mode's preset plugins are a fixed dataset
 * with no clone behind them.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, openApp, skipOnWindows } from '../fixtures/app';
import { makeTempDir } from '../fixtures/temp-root';

/** A git repository holding one panel plugin, committed and cloneable. */
interface PluginRepo {
  url: string;
  /** Commit a new version, moving the repository's HEAD. */
  advance(version: string): void;
  dispose(): void;
}

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
}

function makePluginRepo(root: string, id = 'e2e-plugin'): PluginRepo {
  const dir = mkdtempSync(join(root, 'repo-'));
  const write = (version: string): void => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'kabmo.json'), JSON.stringify({ id, name: id, version, app: 'dist/app.js' }));
    writeFileSync(join(dir, 'dist', 'app.js'), `export default { version: ${JSON.stringify(version)} };`);
  };
  write('1.0.0');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'e2e@example.com']);
  git(dir, ['config', 'user.name', 'E2E']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'v1.0.0']);

  return {
    url: dir,
    advance(version: string) {
      write(version);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', `v${version}`]);
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The Panel Plugins settings category, opened from the sidebar. */
async function openPanelPlugins(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Panel Plugins' }).click();
}

/** Install one plugin through the pane's own form. */
async function installFromUrl(page: import('@playwright/test').Page, url: string): Promise<void> {
  const field = page.getByPlaceholder('https://github.com/you/my-panel.git');
  await field.fill(url);
  const installed = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/panels/install',
  );
  // Scoped to the FORM: the Available grid renders an `Install` button per store
  // entry, so the bare name resolves to several and a strict-mode click throws.
  await page.locator('form').filter({ has: field }).getByRole('button', { name: 'Install', exact: true }).click();
  await installed;
}

test.describe('panel plugins', () => {
  test('installs a git plugin and shows its freshness row', async ({ harness, page }) => {
    skipOnWindows('installs a plugin from a local git clone');
    const server = await harness('real');
    const root = makeTempDir('plugin-');
    const repo = makePluginRepo(root);
    try {
      await openApp(page, server.baseURL);
      await openPanelPlugins(page);

      await installFromUrl(page, repo.url);

      // The card is drawn from the installed list, and the freshness row only
      // exists when the scan found an origin — a wrong derivation renders
      // nothing here, which is indistinguishable from "nothing to update".
      const card = page.locator('article').filter({ hasText: 'e2e-plugin' });
      await expect(card).toBeVisible();
      await expect(card.getByText('not checked', { exact: false })).toBeVisible();
      await expect(card.getByText('git ·', { exact: false })).toBeVisible();
    } finally {
      repo.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('detects a newer commit and updates to it', async ({ harness, page }) => {
    skipOnWindows('installs a plugin from a local git clone');
    const server = await harness('real');
    const root = makeTempDir('plugin-');
    const repo = makePluginRepo(root);
    try {
      await openApp(page, server.baseURL);
      await openPanelPlugins(page);
      await installFromUrl(page, repo.url);

      const card = page.locator('article').filter({ hasText: 'e2e-plugin' });

      // First check: the clone IS the remote's head, so there is nothing to do.
      const checked = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/panels/install',
      );
      await page.getByRole('button', { name: 'Check for updates' }).click();
      await checked;
      await expect(card.getByText('up to date', { exact: false })).toBeVisible();

      // Move the remote, then ask again. The freshness map rides the SCAN
      // payload, so a response that did not invalidate the cache would still
      // render "up to date" here.
      repo.advance('2.0.0');
      const rechecked = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/panels/install',
      );
      await page.getByRole('button', { name: 'Check for updates' }).click();
      await rechecked;

      const update = card.getByRole('button', { name: 'Update' });
      await expect(update).toBeVisible();

      const updated = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/panels/install',
      );
      await update.click();
      await updated;

      // The files moved, so the row now reports the new commit as current — the
      // observable that actually changes, not the button that was clicked.
      await expect(card.getByText('up to date', { exact: false })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Update' })).toBeHidden();
    } finally {
      repo.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the auto-update switch reflects the server, both ways', async ({ harness, page }) => {
    // The harness owns the server's lifetime and its temp root — a spec that
    // removed the root itself would race the fixture's own teardown.
    const server = await harness('real');
    await openApp(page, server.baseURL);
    await openPanelPlugins(page);

    const toggle = page.getByRole('checkbox', { name: 'Auto-update git plugins' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Off — updates are applied only when you press Update.')).toBeVisible();

    const on = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/panels/install',
    );
    await toggle.click();
    await on;

    // The flag travels on the cached scan payload too: a response that did not
    // invalidate it left the checkbox reading the previous value, so it snapped
    // back under the click.
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('with no confirmation', { exact: false })).toBeVisible();

    // And it survives a reload, because the server is what holds it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPanelPlugins(page);
    await expect(page.getByRole('checkbox', { name: 'Auto-update git plugins' })).toHaveAttribute('aria-checked', 'true');
  });
});
