/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Wait for session": a prompt held until another session finishes.
 *
 * The assembled proof, because every step is invisible to a unit test: a real
 * run streams in session A, a NEW chat in session B picks A from the composer,
 * B's row survives with a waiting cue, and when A's run ends the SERVER spawns
 * B's session and sends the prompt — from a process the browser never called.
 *
 * The two assertions that matter most are the ones a "it looks right" check
 * would miss: B must NOT start before A is finished (a prompt delivered into a
 * running dependency is exactly what the feature prevents), and B must start
 * WITHOUT the user doing anything after A ends.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import type { Page } from '@playwright/test';

/**
 * Open a NEW chat inside the seeded workspace.
 *
 * The folder's OWN button, not the toolbar's: the toolbar's New Session
 * inherits the current session's folder by looking it up in the sidebar, and a
 * session omp has not scanned yet (a fresh spawn writes its transcript only
 * when the first assistant message settles) is not in that list — so it drops
 * `?folderId=` and the composer opens disabled. The folder's button names its
 * folder explicitly, which is also what a user does when they mean this
 * workspace.
 */
async function newChatIn(page: Page, folderName: string) {
  await page.getByRole('button', { name: `New session in ${folderName}` }).first().click();
  await expect(page).toHaveURL(/sessionId=new-/);
}

/**
 * Send a prompt and wait only for the turn to be DISPATCHED.
 *
 * The difference matters: the picker offers sessions whose run is in flight, so
 * the second chat has to be opened while the first one is still streaming. A
 * send that waited for the answer would finish the dependency before the pick
 * was even possible — and then there is nothing to wait for.
 *
 * The gate is the composer's OWN "Stop generation" control, not the sidebar
 * row's spinner. The bubble is painted by the send path before the server has a
 * `stream` row, and the picker is derived from that row — so asserting the
 * bubble and then racing the picker was the measured failure on the Windows
 * runner: the dependency's run had ended by the time the picker's timeout
 * expired.
 *
 * A sidebar-row gate cannot work here, and the page snapshot proves it: a new
 * chat's row is drawn under the pending `new-…` id, while the server's `stream`
 * row names omp's own uuid, so the row renders no status until the spawn answers
 * AND the structure scan catches up. Measured on the Windows runner it had still
 * not happened after 30s (`Delay:75000 session A now` in the snapshot), which is
 * why the two attempts before this failed on the gate rather than on the picker.
 *
 * `Stop generation` is a property of the composer the run belongs to: it is
 * rendered whenever that chat is in flight, from the client's own generating
 * state, so it needs no sidebar render and no scan.
 */
async function sendAndKeepRunning(page: Page, text: string) {
  const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
  // The optimistic bubble is the send's own receipt.
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
  // And the run is really in flight — the composer swaps Send for Stop for as
  // long as its chat is generating.
  await expect(page.getByTitle('Stop generation')).toBeVisible({ timeout: 30_000 });
}

/** Read the server's waiting rows through the page's own API. */
async function waitingRows(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/waiting');
    const data = await response.json();
    return (data.prompts ?? []) as { status: string; sessionId: string | null; prompt: string }[];
  });
}

// A dependency run outlives the pick by design, so the file needs more than the
// 60s default: the first case spends up to 30s proving the run reached the
// client, then waits for that run to END (up to `delay`) after the pick.
test.describe.configure({ timeout: 180_000 });

test.describe('wait for session', () => {
  test('holds a new chat prompt until the picked session finishes', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-wait').first()).toBeVisible();

    // Session A: a long run, still streaming when the second chat opens — the
    // picker offers exactly the sessions whose run is in flight, so the window
    // has to outlast opening a second chat and picking it. Measured: 8s was not
    // enough; 20s then made the window the SAME length as the picker's own
    // timeout, so a slow runner expired the run while the assertion was still
    // counting (the Windows leg failed this way twice on one push while Linux
    // passed). The run is now LONGER than the gate's own budget, so a slow
    // runner still leaves a real window to pick in: `delay` minus however long
    // the gate took.
    await newChatIn(page, 'e2e-wait');
    await sendAndKeepRunning(page, 'delay:75000 session A');

    // Session B: a NEW chat, with A picked as its dependency.
    await newChatIn(page, 'e2e-wait');
    // The picker appears once the sidebar's status map reports A as streaming,
    // which arrives over the realtime socket rather than with the send.
    const picker = page.locator(`[data-testid="${TESTID.waitPicker}"]`);
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await expect(picker).toBeEnabled();
    await picker.click();
    // The CANDIDATE, scoped to the dropdown: the same title is on A's sidebar
    // row, and clicking that opens A instead of choosing it as a dependency.
    const candidates = page.locator(`[data-testid="${TESTID.waitCandidate}"]`);
    await expect(candidates).toHaveCount(1);
    await candidates.first().click();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill('held for session A');
    await input.press('Enter');

    // The row stays, saying what it waits for — the reported requirement.
    await expect(page.getByText(/waiting for .*session A/i).first()).toBeVisible({ timeout: 15_000 });
    // And nothing ran: B has no answer of its own while A is still going.
    await expect(page.getByText('Response to: held for session A')).toHaveCount(0);

    // A finishes; B is released by the SERVER, with no further user action. Two
    // observables, and the URL one is the client's: the held chat is on screen,
    // so the adoption rewrites `?sessionId=` from the pending id to omp's.
    //
    // The ANSWER is deliberately not asserted. It streams in the instant the
    // dispatch lands, before this page's topic subscription exists — the run is
    // started by the server, so there is no send call here to attach first. A
    // reload reads it back from the transcript, which is the real guarantee.
    // Bounded by the dependency's own `delay`, which starts at dispatch — the
    // gate above may already have spent part of it, so this is generous rather
    // than tight.
    await expect(page).toHaveURL(/sessionId=(?!new-)[0-9a-f-]{8}/, { timeout: 90_000 });
    await expect(page.getByText(/waiting for .*session A/i)).toHaveCount(0);
    const rows = await waitingRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'dispatched', prompt: 'held for session A' });
    expect(rows[0]?.sessionId).toBeTruthy();

    workspace.dispose();
  });

  test('cancelling the wait drops the row and sends nothing', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-wait-cancel');
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-wait-cancel').first()).toBeVisible();

    await newChatIn(page, 'e2e-wait-cancel');
    // Same window as the first test, for the same reason.
    await sendAndKeepRunning(page, 'delay:75000 session A');

    await newChatIn(page, 'e2e-wait-cancel');
    const picker = page.locator(`[data-testid="${TESTID.waitPicker}"]`);
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await picker.click();
    const candidates = page.locator(`[data-testid="${TESTID.waitCandidate}"]`);
    await expect(candidates).toHaveCount(1);
    await candidates.first().click();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill('never sent');
    await input.press('Enter');
    await expect(page.getByText(/waiting for .*session A/i).first()).toBeVisible({ timeout: 15_000 });

    await page.locator(`[data-testid="${TESTID.cancelHeldPrompt}"]`).click();
    await expect(page.getByText(/waiting for .*session A/i)).toHaveCount(0, { timeout: 15_000 });

    // Past A's own run the cancelled row must still be `cancelled`, not
    // `dispatched`: the wait was dropped before its dependency finished.
    await expect.poll(async () => (await waitingRows(page))[0]?.status, { timeout: 40_000 }).toBe('cancelled');
    const rows = await waitingRows(page);
    expect(rows[0]?.sessionId).toBeNull();
    // The cancelled chat keeps its pending id: nothing was dispatched, so there
    // is no session for it to have adopted.
    await expect(page).toHaveURL(/sessionId=new-/);

    workspace.dispose();
  });
});
