/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scrollbar fades while the agent is still streaming, with nobody touching
 * the page.
 *
 * This is the assembled proof of the reveal rule, and it exists because the
 * bug it pins is invisible to every other layer. A programmatic scroll fires a
 * real, trusted `scroll` event, so the timeline's own stick-to-bottom
 * `pinToBottom` — which runs on every frame of a live run — re-armed the fade
 * continuously. The attribute never lapsed for the length of a turn and the
 * bar sat on screen over a conversation nobody was scrolling, which is exactly
 * what a reader reported. `scrollbar-activity.test.ts` pins the gate at the
 * unit level; this spec pins that the gate is still reachable from the real
 * timeline, through the real stream, on the real element.
 *
 * Two assertions, and the second is what keeps the fix honest: a wheel the
 * reader actually turned must still reveal the bar. A gate that simply ignored
 * every scroll would pass the first one and break the feature.
 *
 * The viewport is SHORT on purpose. The transcript has to overflow its
 * container for the run's auto-follow to move it at all, and the scripted
 * child streams at 30 ms per character — a prompt long enough to overflow a
 * 900px-tall window would take a minute and a half to arrive. A 420px window
 * overflows on a few hundred characters, which keeps the run live through the
 * whole observation.
 */

import { test, expect } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import type { Page } from '@playwright/test';

/**
 * Find the transcript's scroll container, IN the page, on every call.
 *
 * Found by walking up from a message row rather than by a class or an id: the
 * pending view and the adopted chat timeline are different components with
 * different classes, and the row ids are the one thing both carry. Re-derived
 * rather than held as a handle, because a node captured across a streamed
 * frame is detached — and an assertion run against the detached node reports
 * "not revealed" for an element nobody is looking at any more.
 */
const TRANSCRIPT = `(() => {
  const row = document.querySelector('[id^="msg-"]');
  if (!row) return null;
  let node = row.parentElement;
  while (node) {
    if (node.scrollHeight > node.clientHeight + 40) return node;
    node = node.parentElement;
  }
  return null;
})()`;

/** Whether the reveal attribute is on the transcript's scroller right now. */
function revealed(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    const el = ${TRANSCRIPT};
    return el ? el.hasAttribute('data-scrollbar-active') : false;
  })()`);
}

test.describe('scrollbar reveal', () => {
  test('fades during a live run, and still reveals on a real wheel', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-scrollbar');
    await page.setViewportSize({ width: 1280, height: 420 });

    await page.goto(`${server.baseURL}/?folderId=${workspace.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('e2e-scrollbar').first()).toBeVisible();

    // `slow` streams one character at a time, so the run stays live for
    // seconds — long enough for the auto-follow to have re-armed the fade many
    // times under the old rule, and long enough to observe it lapse under this
    // one. The child ECHOES the prompt as its answer, so the prompt's length is
    // what makes the answer overflow.
    const prompt = `slow ${'the scrollbar reveal rule, and why a programmatic scroll is not a user. '.repeat(6)}`;
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill(prompt);
    await input.press('Enter');
    await expect(page.getByText(/Response to: slow the scrollbar reveal rule/).first()).toBeVisible({ timeout: 30_000 });

    // The answer is arriving and the transcript overflows, which is what makes
    // the run's own auto-follow move it. Waited for rather than assumed: a
    // container that does not scroll has no bar to fade, and the assertion
    // below would then pass for the wrong reason.
    await expect
      .poll(() => page.evaluate(`Boolean(${TRANSCRIPT})`), { timeout: 20_000, intervals: [200] })
      .toBe(true);

    // THE ASSERTION THE BUG FAILED: with the pointer parked in a corner and no
    // input of any kind, the bar must not still be painted. Polled rather than
    // sampled once, because the fade is a 5 s window and the stream keeps
    // moving the container throughout — under the old rule this never became
    // false for the life of the turn.
    await page.mouse.move(2, 2);
    await expect.poll(() => revealed(page), { timeout: 15_000, intervals: [250] }).toBe(false);

    // ...and the feature still works: a wheel the reader turns reveals it.
    // UPWARD, because the run has pinned the viewport to the tail — a downward
    // wheel there is already at its limit and scrolls nothing, so it would
    // report a broken reveal for a container that simply could not move.
    const box = await page.evaluate(`(() => {
      const el = ${TRANSCRIPT};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`) as { x: number; y: number; w: number; h: number } | null;
    if (!box) throw new Error('the transcript never overflowed its container');
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => revealed(page), { timeout: 3_000, intervals: [100] }).toBe(true);

    workspace.dispose();
  });
});
