/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Command Runner plugin, end to end: install it, list a repository's
 * commands, run one, read its output, and prove a repo switch kills what is
 * running.
 *
 * This is the layer the bugs live in. Every claim below is invisible to a unit
 * test:
 *
 * - the plugin's two bundles must actually BUILD and be served, which is the
 *   install route's own work;
 * - the command list comes from a real filesystem walk over a real repository,
 *   through the plugin's own RPC and the host's route;
 * - a run is a real `Bun.spawn`, so its output, exit code and kill are the OS's,
 *   not a fixture's;
 * - the force-stop needs the CONTENT SCRIPT, which mounts only because the
 *   plugin is enabled — and the panel it belongs to is unmounted while another
 *   view is on screen, which is exactly the case a component test cannot reach.
 *
 * The repository is a temp directory seeded through the real folder API, and the
 * command it runs writes a file whose EXISTENCE is the assertion — a command's
 * effect on disk is what proves it ran, not a rendered row.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** Install the bundled plugin through the real route. */
async function installRunner(baseURL: string): Promise<void> {
  const response = await fetch(`${baseURL}/api/panels/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'install', pluginId: 'command-runner' }),
  });
  expect(response.ok).toBe(true);
  // The route answers after the BUILD, but the CLIENT only learns about the
  // plugin from the `panels` topic. Waiting here (rather than at the click) means
  // the readiness question is asked once, and a later assertion cannot be the one
  // that pays for it.
  await waitForPanelRegistered(baseURL, 'command-runner');
}

/**
 * Poll the panel registry until the plugin is listed.
 *
 * The client's button appears only after the topic frame carrying this payload
 * lands, so a spec that navigated in the gap raced it — measured as
 * `getByRole('button', { name: 'Commands — Runner' })` timing out on the FIRST
 * spec of a file and passing on retry. Waiting on the server's own view first
 * makes the client-side wait a formality rather than the thing that decides.
 */
async function waitForPanelRegistered(baseURL: string, pluginId: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${baseURL}/api/panels`);
    if (response.ok) {
      const payload = (await response.json()) as { panels?: Array<{ pluginId?: string }> };
      if ((payload.panels ?? []).some((panel) => panel.pluginId === pluginId)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the panel registry never listed "${pluginId}"`);
}

/**
 * Open the app and wait for the plugin's activity-bar button.
 *
 * The install answers over HTTP, but the CLIENT learns about the plugin from the
 * `panels` topic — and the button only exists once its bundle has loaded and its
 * `rightPanel` registered. A spec that clicked straight after `goto` raced that
 * round trip and failed with "element not found" (measured, flaky). So the wait
 * is on the button itself, which is the condition the next click needs.
 */
async function openRunner(page: Page, url: string): Promise<void> {
  await openApp(page, url);
  // Generous: the button needs the bundle import to finish AND its `rightPanel`
  // to register, and on a loaded machine that is the slowest thing in the spec.
  await expect(commandsButton(page)).toBeVisible({ timeout: 60_000 });
}

/**
 * Turn a row's background toggle ON, whatever state it is in.
 *
 * A blind click flips the toggle either way, and the flag is persisted per
 * SESSION — so a spec that ran earlier in the same file can leave it on, and the
 * "second" click turns it OFF. Measured: this made the log spec flaky (green
 * alone, red after the others). The fix is to read the state and set it, not to
 * assume a click produces the state you want.
 */
async function ensureBackgroundOn(page: Page, label: string): Promise<void> {
  // The name does NOT begin with `Run` like the Run control beside it: two
  // buttons whose accessible names share a prefix is what forced `exact: true`
  // here, and a screen reader heard two controls beginning the same words.
  const toggle = page.getByRole('button', { name: new RegExp(`^Keep ${label} running in the background`) });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** The visible Commands panel's activity-bar button. */
function commandsButton(page: Page) {
  return page.getByRole('button', { name: 'Commands — Runner' });
}

test.describe('command runner plugin', () => {
  test('lists a repository\u2019s commands grouped by file, and runs one', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-commands');
    await installRunner(server.baseURL);

    // A repository with two command sources and a marker the run writes, so the
    // assertion is on disk rather than on a rendered row.
    const marker = join(workspace.path, 'ran.txt');
    writeFileSync(
      join(workspace.path, 'package.json'),
      JSON.stringify({ scripts: { hello: `node -e "require('fs').writeFileSync('${marker}','ok')"` } }),
    );
    writeFileSync(join(workspace.path, 'Makefile'), '.PHONY: greet\ngreet:\n\techo greeted');

    await openRunner(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await commandsButton(page).click();

    // The group header is the repo-relative FILE, which is what distinguishes
    // three `package.json` groups in a monorepo.
    await expect(page.getByText('package.json').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Makefile').first()).toBeVisible();

    // The row's label carries the RESOLVED runner, so the guess is visible, and
    // the Run control is icon-only — its accessible name is the whole handle.
    const row = page.getByRole('button', { name: 'Run bun run hello', exact: true });
    await expect(row).toBeVisible();
    await row.click();

    // The run really happened: the marker file exists.
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe('ok');

    workspace.dispose();
  });

  test('a run\u2019s output opens in its own row, as a code block', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-commands-log');
    await installRunner(server.baseURL);

    // A command that PRINTS, so the log has something to show.
    writeFileSync(
      join(workspace.path, 'package.json'),
      JSON.stringify({ scripts: { speak: 'echo COMMAND-RUNNER-SPOKE' } }),
    );

    await openRunner(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await commandsButton(page).click();

    // Before it runs, the row has nothing to expand: its disclosure is disabled.
    await expect(page.getByRole('button', { name: /has not run yet/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Run bun run speak', exact: true }).click();

    // A run OPENS its own row, so the output lands without a second click.
    await expect(page.getByText('COMMAND-RUNNER-SPOKE').first()).toBeVisible({ timeout: 20_000 });
    // And the outcome is named, not implied.
    await expect(page.getByText(/exit 0/).first()).toBeVisible();

    workspace.dispose();
  });

  // SKIPPED ON WINDOWS, and both halves of the mechanism are the reason: the
  // marker is a `#!/bin/sh` script whose PATH must stay in the process's argv
  // (Windows cannot spawn a `sh` script at all — see the harness note on
  // libuv's `search_path`), and the liveness probe is `pgrep`, which Windows
  // does not ship. The sweep being tested is the plugin's own `stop-others`;
  // the unit suite covers its matching rules directly.
  test('switching repo force-stops a background run', async ({ harness, page }) => {
    // Inside the body, not at the describe level: this file has other tests
    // that DO run on Windows, and a top-level `test.skip(condition)` would take
    // them with it.
    test.skip(process.platform === 'win32', 'needs a POSIX shell script and pgrep');

    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-commands-stop');
    await installRunner(server.baseURL);

    // A script whose PATH stays in the process's argv, so a `ps` check can find
    // it. A `sh -c 'sleep 300 # marker'` would NOT work: `sh` execs into `sleep`
    // and the comment is gone from the argv (measured while writing this).
    const script = join(tmpdir(), `cr-e2e-${process.pid}-${Date.now()}.sh`);
    writeFileSync(script, '#!/bin/sh\nsleep 300\n');
    writeFileSync(join(workspace.path, 'Makefile'), `slow:\n\tsh ${script}`);

    // A nested repo to switch TO, so the pick has somewhere to go.
    mkdirSync(join(workspace.path, 'other', '.git'), { recursive: true });

    try {
      await openRunner(page, `${server.baseURL}/?folderId=${workspace.id}`);
      await commandsButton(page).click();

      // The per-command background toggle: ON, so the run is tracked as a job.
      await ensureBackgroundOn(page, 'make slow');

      await page.getByRole('button', { name: 'Run make slow', exact: true }).click();

      // The job is listed and the process is alive.
      await expect(page.getByText('Running').first()).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => markerCount(script), { timeout: 20_000 }).toBeGreaterThan(0);

      // Switch to the nested repo from the FILE panel — the Commands panel is
      // unmounted by then, which is the case the content script exists for.
      await page.getByRole('button', { name: 'Files' }).click();
      const picker = page.locator('button[title="Switch git project"]:visible');
      await picker.focus();
      await page.keyboard.press('Enter');
      const option = page.locator('[role="option"]:visible', { hasText: 'other' });
      await expect(option).toBeVisible({ timeout: 20_000 });
      await option.focus();
      await page.keyboard.press('Enter');

      // The sweep killed it: no process, and the panel's own list is empty when
      // it comes back.
      await expect.poll(() => markerCount(script), { timeout: 20_000 }).toBe(0);
      await commandsButton(page).click();
      await expect(page.getByText('Running')).toHaveCount(0);
    } finally {
      rmSync(script, { force: true });
      workspace.dispose();
    }
  });
});

/** How many processes currently have `needle` in their command line. */
function markerCount(needle: string): number {
  try {
    // `execFileSync` THROWS on a non-zero exit, and `pgrep` exits 1 when it
    // matches nothing — which is the answer this is asking for.
    const out = execFileSync('pgrep', ['-f', needle], { stdio: 'pipe' }).toString().trim();
    return out ? out.split('\n').length : 0;
  } catch {
    return 0;
  }
}
