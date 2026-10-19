/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A full chat turn, driven through the real spawn path with a scripted child.
 *
 * This is the spec the whole layer exists for. It exercises what no unit test
 * can: the server spawns `omp` (here the fake), the child streams full
 * `message_update` frames, the fold marks the run live, the realtime topic
 * pushes it to the browser, and the timeline renders the user bubble and the
 * streamed answer — with the run footer settling when `agent_end` arrives.
 * Every one of those steps has been a real regression; none is visible to a
 * happy-dom mount.
 *
 * It runs in `real` mode (MOCK=false) with `KABMO_OMP_BIN` pointed at the
 * scripted child, so there is no model and no network, but there IS a real
 * process, a real protocol, and a real stream.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import { expectIndicatorSurvivesLongPhrase } from '../fixtures/indicator';
import type { Page } from '@playwright/test';

/**
 * Open a seeded workspace and send a prompt, waiting for the conditions the
 * send path actually needs.
 *
 * The wait on the folder's NAME is load-bearing, not cosmetic: `send.ts`
 * resolves the spawn `cwd` from the sidebar's folder list, which loads
 * asynchronously. Pressing Enter before that list contains the folder leaves
 * `cwd` undefined, the send falls to the MOCK path, and real mode refuses it
 * with a 400 — so nothing renders and the spec fails with "element not found"
 * for a reason nothing on screen names. Verified: without this wait the
 * `delay:` spec failed intermittently.
 */
async function sendPrompt(page: Page, server: { baseURL: string }, folderId: number, folderName: string, text: string) {
  await openApp(page, `${server.baseURL}/?folderId=${folderId}`);
  await expect(page.getByText(folderName).first()).toBeVisible();
  const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
}

test.describe('chat', () => {
  test('sends a prompt and renders the streamed answer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chat');

    await sendPrompt(page, server, workspace.id, 'e2e-chat', 'hello from the e2e spec');

    // The user turn renders immediately (optimistic), then the answer streams
    // in. Both are asserted by text, which is what a reader would see.
    await expect(page.getByText('hello from the e2e spec').first()).toBeVisible();
    await expect(page.getByText('Response to: hello from the e2e spec').first()).toBeVisible({ timeout: 30_000 });

    workspace.dispose();
  });

  test('settles the run footer once the turn ends', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chat-settle');

    await sendPrompt(page, server, workspace.id, 'e2e-chat-settle', 'delay:300 settle me');

    await expect(page.getByText('Response to: delay:300 settle me').first()).toBeVisible({ timeout: 30_000 });
    // The generating indicator is gone once `agent_end` lands — the failure
    // this pins is a run that renders its answer and spins forever.
    await expect(page.getByText(/thinking/i)).toHaveCount(0, { timeout: 30_000 });

    workspace.dispose();
  });

  test('a tool call renders as a named card in the timeline', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chat-tool');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-chat-tool').first()).toBeVisible();

    // Record every tool-card title the DOM ever shows, not just the final one.
    // The finished card is IDENTICAL either way — `toolcall_end` hands over the
    // whole block — so an assertion on the settled state cannot see the bug.
    // What was broken is the card DURING the argument stream: it read a bare
    // `Tool` with no subtitle, because the accumulator discarded the seed's
    // `id`/`name` and never parsed the arriving `arguments`. The fixture
    // streams its arguments slowly so this window is observable.
    await page.evaluate(() => {
      const titles = new Set<string>();
      const holder = window as unknown as Record<string, unknown>;
      holder.__toolTitles = titles;
      const record = () => {
        for (const button of document.querySelectorAll('[aria-label^="Expand "]')) {
          const label = button.getAttribute('aria-label');
          if (label) titles.add(label.slice('Expand '.length));
        }
      };
      record();
      new MutationObserver(record).observe(document.body, { childList: true, subtree: true, attributes: true });
    });

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('tool:bash then answer');
    await input.press('Enter');

    await expect(page.getByRole('button', { name: /^Expand Bash/ }).first()).toBeVisible({ timeout: 30_000 });

    const titles = await page.evaluate(() => {
      const holder = window as unknown as Record<string, unknown>;
      const seen = holder.__toolTitles;
      return seen instanceof Set ? [...seen].filter((entry): entry is string => typeof entry === 'string') : [];
    });
    // Every title seen must name the tool: the placeholder `Tool` never appears.
    for (const title of titles) expect(title).toMatch(/^Bash/);
    expect(titles.some((title) => title.startsWith('Bash'))).toBe(true);

    workspace.dispose();
  });

  /**
   * A long activity phrase must never cost the indicator its identity or its
   * dots.
   *
   * The reported bug, on desktop and phone alike: the verb was a non-shrinking
   * span, so `Running <a long command>` took its full width, the provider and
   * model spans (shrinkable, `min-w-0`) collapsed to zero, and the trailing
   * dots were clipped by the row's `truncate` — a busy run showed neither who
   * was answering nor that anything was happening. Only a real browser has
   * layout, so this is measured, not asserted on a class list.
   *
   * The chat column is narrowed for the same reason: the dock is 970px wide on
   * a 1440px viewport, where a 150-character command still fits. The width the
   * contract has to hold at is the one the panel actually gives it — and on a
   * phone it is a third of that.
   */
  test('keeps the provider, model and dots when the activity phrase is long', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chat-indicator');

    // Above the 768px mobile breakpoint (so this runs the desktop tree) but
    // narrow enough that the dock cannot fit a 72-character phrase beside its
    // identity. Measured: at 1024 with both panels open the chat column is
    // 453px against a 477px phrase.
    await page.setViewportSize({ width: 1024, height: 900 });
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-chat-indicator').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();

    // Warm the session first. The FIRST prompt spawns the child, and the spawn
    // path republishes the session topic, whose snapshot calls
    // `onResumeStream` — a write that must not clobber a live phrase (pinned
    // in `omp-callbacks.test.ts`, since the ordering there is a race a browser
    // spec cannot hold). A warm session never re-attaches, so this spec
    // measures the truncation contract without depending on that race.
    await input.fill('warm up');
    await input.press('Enter');
    await expect(page.getByText('Response to: warm up').first()).toBeVisible({ timeout: 30_000 });

    const command = 'rg -n --hidden --glob "!node_modules" "someVeryLongPatternThatKeepsGoing" src/client/components/workspace';
    await input.fill(`tool:bash cmd:${command} then answer`);
    await input.press('Enter');

    await expectIndicatorSurvivesLongPhrase(page, command);

    workspace.dispose();
  });

  /**
   * The run footer must never paint over a row that carries no answer.
   *
   * `resolveRunFooters(messages, isGenerating)` withholds the footer while the
   * run streams, and the flag it is handed is `timelineRunning` — the server's
   * `stream` row. That row reaches the client over the `sidebar:status` topic a
   * beat AFTER the send arms the optimistic user + AI-placeholder pair, so for
   * ~120-250 ms a real session reported `isGenerating: false` and the run looked
   * settled: a model/duration footer landed on the EMPTY placeholder row and was
   * withdrawn the moment the row arrived. That is the footer that "appears for an
   * instant" on every prompt.
   *
   * The assertion is the reader's own: no footer is ever attached to a row whose
   * text is blank. A final-state check cannot see it — the settled transcript is
   * identical either way — so the DOM is sampled across the whole run.
   */
  test('never paints the run footer over an empty row while a prompt starts', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chat-footer');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-chat-footer').first()).toBeVisible();

    // Record the owner row of every footer the DOM ever shows, with that row's
    // text at that instant. Sampled per animation frame (a flash shorter than a
    // task's own duration would slip past a MutationObserver alone) and once
    // more from the observer, so a paint cannot be missed between frames.
    await page.evaluate(() => {
      const holder = window as unknown as Record<string, unknown>;
      const seen: Array<{ id: string; text: string }> = [];
      holder.__footerRows = seen;
      const sample = () => {
        for (const button of document.querySelectorAll('[aria-label="Retry response"]')) {
          const wrapper = button.closest('div.mt-2') ?? button.parentElement;
          const row = wrapper?.previousElementSibling as HTMLElement | null;
          seen.push({ id: row?.id ?? '', text: (row?.textContent ?? '').trim() });
        }
      };
      sample();
      let running = true;
      const tick = () => {
        if (!running) return;
        sample();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      holder.__stopSampling = () => { running = false; };
    });

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('delay:600 footer flash probe');
    await input.press('Enter');

    // Wait for the run to settle, so the sampling covers the dispatch window,
    // the stream and the settle.
    await expect(page.getByText('Response to: delay:600 footer flash probe').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/thinking/i)).toHaveCount(0, { timeout: 30_000 });
    await page.evaluate(() => (window as unknown as Record<string, () => void>).__stopSampling?.());

    const samples = await page.evaluate(() => (window as unknown as Record<string, Array<{ id: string; text: string }>>).__footerRows ?? []);
    // The footer does render once the run settles — otherwise this spec would
    // pass on a broken timeline that never draws one.
    expect(samples.length).toBeGreaterThan(0);
    // ...and never over a row with no answer in it. The optimistic placeholder
    // row is exactly that: an `id` with an empty body.
    const blank = samples.filter((sample) => sample.text.length === 0);
    expect(blank, `footer painted over a blank row: ${JSON.stringify(blank)}`).toEqual([]);

    workspace.dispose();
  });
});
