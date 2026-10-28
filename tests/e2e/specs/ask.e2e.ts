/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The inline `ask` card, driven end to end against a scripted child.
 *
 * Two reported defects live here, and neither is visible to a happy-dom mount:
 *
 * 1. The grouped `ask` (omp's `method:"ask"` frame, one dialog for every
 *    question) rendered as a compact chip strip that ran sideways, unlike the
 *    standalone per-question card.
 * 2. Submitting it made the card read "Waiting for the previous answer…" on
 *    every question — the frame left the pending queue the instant the response
 *    was sent, and omp writes no tool result until the tool call finishes, so
 *    for that whole window the card looked unanswered even though the answers
 *    had been delivered and the agent was acting on them.
 *
 * The spec asserts on the DOM the user reads: answer rows stacked one per line,
 * and no "Waiting for the previous answer" text in the post-submit window.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('ask tool', () => {
  test('answers stack as rows and the card stays answered after submit', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-ask');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-ask').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('ask:Choose a flavour');
    await input.press('Enter');

    // The card renders both questions from the tool call's arguments, each as
    // the same numbered card the standalone ask draws.
    await expect(page.getByText('Choose a flavour').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Choose a flavour — which ones?')).toBeVisible();

    // omp's own `description` for each choice is VISIBLE text on the row, not a
    // hover tooltip: its ask prompt puts the tradeoff there, so a chip that hid
    // it asked the user to pick blind (and a phone can never hover).
    await expect(page.getByText('Go ahead with it')).toBeVisible();
    await expect(page.getByText('The second one')).toBeVisible();

    // Pick one answer on each question, then submit the grouped dialog. The
    // option row's accessible name carries its description too (that is the
    // point of the fix above), so these match on the label's prefix.
    await page.getByRole('button', { name: /^Yes\b/ }).click();
    await page.getByRole('button', { name: /^Alpha\b/ }).click();
    await page.getByRole('button', { name: 'Submit answers' }).click();

    // The answers must read back as their own rows, stacked — not one sideways
    // run-on strip, and not a chip strip at all.
    const rows = page.locator('[data-answer-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText('Yes');
    await expect(rows.nth(1)).toHaveText('Alpha');

    // ...and the card must not fall back to "unanswered" while the child runs
    // the turn. The fake holds the result until the response lands, so this is
    // the exact window the bug lived in.
    await expect(page.getByText('Waiting for the previous answer…')).toHaveCount(0);
    await expect(page.getByText('answered').first()).toBeVisible();

    workspace.dispose();
  });
});
