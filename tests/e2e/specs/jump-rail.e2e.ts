/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop jump rail: its hit target and its jump.
 *
 * Both halves of the reported bug are only observable in a real browser.
 * happy-dom computes NO layout, so a mounted rail in a unit test has no
 * geometry — it cannot see that a 12x1 element sits dead-centre of a 24x7 row,
 * nor what `getComputedStyle(el).cursor` resolves to. That is precisely what
 * broke:
 *
 *  1. The tick was its OWN element — a 1px `<button>` at the row's vertical
 *     centre — with no handler and no `cursor` rule. Aiming at the line (the
 *     obvious thing to aim at) showed the tooltip, because the ROW's own
 *     `mouseenter` had fired, while the cursor stayed an arrow and the click
 *     landed on an element that did nothing. Measured: `elementFromPoint` over
 *     the line returned `BUTTON` with `cursor: default`.
 *
 *  2. A jump to a turn outside the mounted window PAGES history in, and each
 *     prepended window grew the content above the viewport while follow mode
 *     was still on — so the scroll hook re-pinned to the tail and the viewport
 *     landed back at the bottom instead of on the clicked turn. Measured on a
 *     760-message session: `scrollTop` ended at `max`, i.e. the tail.
 *
 * The jump case needs a session LONG ENOUGH TO WINDOW, and that is why it
 * seeds a real JSONL instead of using the mock presets: `/api/chat/:id` serves
 * a Kabmo-created (DB) session in FULL, with `hasMore: false`, so no paging
 * ever happens and the defect is unreachable. Verified: with the follow-mode
 * fix reverted, the spec still passed against a DB session.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import type { HarnessServer } from '../fixtures/server';

/** user/assistant pairs. Two messages per pair, so this is 240 messages —
 *  double the loader's 120-message window, which is what forces the paging
 *  walk when the FIRST turn is clicked. */
const PAIRS = 120;

/**
 * Write a real omp session JSONL into the harness agent dir and return its id.
 *
 * The file is what the loader actually reads (`findSessionFileById` →
 * `loadSessionMessages`), and it is the only way to get a WINDOWED session:
 * the header carries the id, and each entry is the `{type:"message"}` shape the
 * mapper walks.
 */
function seedJsonlSession(server: HarnessServer): { sessionId: string; dispose: () => void } {
  const sessionId = `01rail${Date.now().toString(16)}`;
  const dir = join(server.runRoot, 'agent', 'sessions', 'rail-project');
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [
    JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: tmpdir() }),
  ];
  for (let i = 1; i <= PAIRS; i += 1) {
    lines.push(JSON.stringify({
      type: 'message',
      id: `u-${i}`,
      parentId: null,
      timestamp: new Date(Date.now() + i).toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: `prompt number ${i}` }], timestamp: Date.now() + i },
    }));
    lines.push(JSON.stringify({
      type: 'message',
      id: `a-${i}`,
      parentId: `u-${i}`,
      timestamp: new Date(Date.now() + i).toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: `answer number ${i}` }], timestamp: Date.now() + i },
    }));
  }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
  return { sessionId, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

test.describe('jump rail', () => {
  test('every pixel of a tick is a pointer target, including the line at its centre', async ({ harness, page }) => {
    const server = await harness('real');
    const seeded = seedJsonlSession(server);
    await openApp(page, `${server.baseURL}/?sessionId=${seeded.sessionId}`);

    const rows = page.locator('[aria-label^="Jump to your message ("] > div');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(PAIRS);

    // Probe a grid over the FIRST row and report what the pointer meets. The
    // old markup answered `BUTTON`/`default` on the line's own pixels — the
    // dead box that showed a tooltip while refusing the click.
    const probes = await rows.first().evaluate((row) => {
      const box = row.getBoundingClientRect();
      const out: Array<{ tag: string; cursor: string }> = [];
      for (let dx = 1; dx < box.width; dx += 3) {
        for (const dy of [1, box.height / 2, box.height - 1]) {
          const el = document.elementFromPoint(box.x + dx, box.y + dy);
          out.push({
            tag: el?.tagName ?? 'none',
            cursor: el ? getComputedStyle(el).cursor : 'none',
          });
        }
      }
      return out;
    });

    expect(probes.length).toBeGreaterThan(10);
    const wrong = probes.filter((probe) => probe.tag !== 'BUTTON' || probe.cursor !== 'pointer');
    expect(wrong, `pixels that are not a pointer target: ${JSON.stringify(wrong)}`).toEqual([]);

    seeded.dispose();
  });

  test('clicking a tick scrolls its turn into view after paging history in', async ({ harness, page }) => {
    const server = await harness('real');
    const seeded = seedJsonlSession(server);
    await openApp(page, `${server.baseURL}/?sessionId=${seeded.sessionId}`);

    const rows = page.locator('[aria-label^="Jump to your message ("] > div');
    await expect(rows.first()).toBeVisible();

    // A real JSONL session loads as the newest window (120 messages), so the
    // FIRST turn is genuinely outside it — reaching it is what forces the
    // paging walk, and the walk is what made the jump fight follow mode.
    const target = 'u-1';
    const row = page.locator(`#${target}`);
    await expect(row).toHaveCount(0);

    // Click the FIRST tick — the dead centre of its row, the exact point that
    // used to be inert. Addressed by the control's own accessible name rather
    // than a pixel offset into the row.
    await page.getByRole('button', { name: `Jump to your message #1 of ${PAIRS}` }).click();

    // The turn is paged in and scrolled into view. The failure this pins: the
    // paging the jump triggers re-pinned the viewport to the tail, so the jump
    // never arrived at the clicked turn.
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect
      .poll(async () => row.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.top >= -8 && box.top <= window.innerHeight - 40;
      }), { timeout: 30_000 })
      .toBe(true);

    seeded.dispose();
  });
});
