/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `wait` card, while it is still BLOCKING.
 *
 * This is the spec the panel exists for, and it is only possible here: a
 * blocking `wait` is the one tool call whose card is watched in real time, and
 * the two things it has to show — an advancing clock and a bar that moves —
 * cannot be asserted from a settled transcript. A unit mount with a fake clock
 * proves the arithmetic; only the real spawn path, the real fold and a real
 * browser prove the frames arrive and the DOM follows them.
 *
 * The fixture's `wait:<seconds>` directive re-emits omp's real
 * `CoordinationDetails` snapshot every 500 ms with a live `durationMs`, so the
 * clock has a source the same way it does in production.
 *
 * Three failures this pins, all of which were real:
 *   1. The card had NO panel (`toolPanelKind` returned null) and rendered as a
 *      title plus an empty Output block.
 *   2. `tool_execution_update` DROPPED the snapshot's `details`, so a running
 *      call had no elapsed time and no job row until it returned.
 *   3. A clock read off a watched job's `durationMs` reports the JOB's age, not
 *      the wait's: measured on a real result, `bg_8` had run 126 s while the
 *      `wait` call took 20 s.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import type { Page } from '@playwright/test';

async function startWait(page: Page, server: { baseURL: string }, folderId: number, folderName: string, seconds: number) {
  await openApp(page, `${server.baseURL}/?folderId=${folderId}`);
  // The folder's NAME on screen is the gate: `send.ts` resolves the spawn cwd
  // from the sidebar's folder list, which loads asynchronously, and a send
  // before it lands falls to the MOCK path (real mode refuses it with a 400).
  await expect(page.getByText(folderName).first()).toBeVisible();
  const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
  await expect(input).toBeVisible();
  await input.fill(`wait:${seconds} hold the turn open`);
  await input.press('Enter');
}

test.describe('wait card', () => {
  test('shows a live stopwatch and a progress bar while the call blocks', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait-live');

    await startWait(page, server, workspace.id, 'e2e-wait-live', 4);

    // A RUNNING wait opens itself — its whole content is a clock, and a
    // collapsed card would hide the one thing the reader watches.
    const card = page.getByRole('button', { name: /^Collapse Wait/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    const track = page.getByRole('progressbar').first();
    await expect(track).toBeVisible();

    // The job row is on screen WHILE the call blocks — the details-dropping bug
    // left the panel with nothing to draw until the call returned.
    await expect(page.getByText('bg_1').first()).toBeVisible();
    await expect(page.getByText('running').first()).toBeVisible();

    // A `bash` job reports no completion percentage, so the bar must not claim
    // one: no aria-valuenow, and the sweeping band instead.
    await expect(track).not.toHaveAttribute('aria-valuenow', /.*/);
    await expect(track.locator('.wait-bar-sweep')).toHaveCount(1);

    // The clock ADVANCES on its own between two samples, which is what makes it
    // a stopwatch rather than a value printed once.
    const clock = page.locator('.text-\\[22px\\]').first();
    const first = await clock.textContent();
    await page.waitForTimeout(1_400);
    const second = await clock.textContent();
    expect(first).toMatch(/^\d+:\d{2}$/);
    expect(second).not.toBe(first);

    // …and the clock is the WAIT's, not the job's age: it starts near zero.
    const seconds = Number((first ?? '0:00').split(':')[0]);
    expect(seconds).toBeLessThan(60);

    workspace.dispose();
  });

  test('settles to a full bar with no animation once the call returns', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait-settled');

    await startWait(page, server, workspace.id, 'e2e-wait-settled', 2);

    // The card is open while running AND after it settles: gating its default on
    // `running` closed it at the exact moment the result arrived, which is when
    // the reader wants it (measured — the settled panel vanished).
    const card = page.getByRole('button', { name: /Wait/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Done', { timeout: 30_000 });
    await expect(card).toHaveAttribute('aria-expanded', 'true');

    const track = page.getByRole('progressbar').first();
    await expect(track).toHaveAttribute('aria-valuenow', '100');
    // A settled call must not keep a sweeping band in scrollback.
    await expect(track.locator('.wait-bar-sweep')).toHaveCount(0);
    await expect(page.getByText('waited').first()).toBeVisible();
    await expect(page.getByText('completed').first()).toBeVisible();

    workspace.dispose();
  });

  test('reports the 30-minute cap when it fires, not “no jobs”', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait-cap');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-wait-cap').first()).toBeVisible();
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('waitcap hold the turn open');
    await input.press('Enter');

    // omp's cap answers `{op:'wait', jobs:[]}` — the same shape a service wake
    // returns — and only its prose distinguishes them. Reporting it as "no jobs"
    // would say the call found nothing rather than that it ran out of time.
    const card = page.getByRole('button', { name: /Wait/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Done', { timeout: 30_000 });
    // Expanded: the panel's own badge names the outcome, and the prose omp wrote
    // is kept — it is the only record of why the call returned with no job.
    await expect(page.getByText('limit reached').first()).toBeVisible();
    await expect(page.getByText('Wait limit reached; background work may still be running.')).toBeVisible();
    // Collapsed: the meta line carries the same claim as a chip (every card
    // hides that line while expanded, because the body already says it).
    await card.click();
    await expect(card).toHaveAttribute('aria-expanded', 'false');
    await expect(card).toContainText('30m limit reached');

    workspace.dispose();
  });

  test('names what it waits for on the collapsed card', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait-header');

    await startWait(page, server, workspace.id, 'e2e-wait-header', 2);

    // A `wait` opens itself, so the collapsed header has to be reached by
    // closing it — the meta line is hidden while expanded (every card hides it
    // there, because the body already carries the path and the output).
    const card = page.getByRole('button', { name: /Wait/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await card.click();
    await expect(card).toHaveAttribute('aria-expanded', 'false');

    // Collapsed, the card still says WHICH job it blocks on and for how long.
    // It used to read a bare `Wait` with nothing else.
    await expect(card).toContainText('bun run probe.ts');
    await expect(card).toContainText('job');

    workspace.dispose();
  });
});
