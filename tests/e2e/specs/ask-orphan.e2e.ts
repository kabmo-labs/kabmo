/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The reported defect: an `ask` dialog with no tool card behind it used to be
 * handed to the MODAL, which has no `ask` body — the panel came up EMPTY with a
 * single "Submit Response" button, and that button sent a bare `{ value }` omp
 * rejects ("Ask dialog response must carry N answers"), so the agent stayed
 * parked on a question the user could not even read.
 *
 * Two shapes reach that state, and both are real: a subagent's own question
 * (its tool call lives in the subagent's transcript, not this session's) and an
 * extension's `askDialog` (the ratchet approval is one), which is not an `ask`
 * tool call at all.
 *
 * The scripted child raises exactly such a frame with `orphan-ask:` — the same
 * `method:"ask"` request with no toolCall block, no `tool_execution_start` and
 * no tool result — so the assertion is on the assembled product: the card must
 * appear IN the timeline, answered there, with no dialog anywhere.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('ask tool without a tool card', () => {
  test('renders inline instead of an empty modal', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-ask-orphan');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-ask-orphan').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('orphan-ask:Which flavour?');
    await input.press('Enter');

    // The questions are ON SCREEN, in the timeline — the empty modal's whole
    // failure was that they were nowhere.
    await expect(page.getByText('Which flavour?').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Which flavour? — which ones?')).toBeVisible();

    // Sampling the window the dialog is live: no overlay may appear at any
    // point. `[role="dialog"]` is what every modal in the app carries.
    for (let i = 0; i < 40; i += 1) {
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
      await page.waitForTimeout(50);
    }

    await page.getByRole('button', { name: /^Yes\b/ }).click();
    await page.getByRole('button', { name: /^Alpha\b/ }).click();
    await page.getByRole('button', { name: 'Submit answers' }).click();

    // Answering it unblocks the child and the card leaves with the frame that
    // raised it. (Not asserted on the question TEXT: the child's own answer is
    // `Response to: orphan-ask:Which flavour?`, which contains it.)
    await expect(page.getByRole('button', { name: 'Submit answers' })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText('Input needed — the agent is blocked until you answer.')).toHaveCount(0);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);

    workspace.dispose();
  });
});
