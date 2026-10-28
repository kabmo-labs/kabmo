/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A run that finishes while the channel is down.
 *
 * The reported failure: a streaming chat left in a background tab lost its
 * socket, the turn ended with nobody reading, and the user came back to an
 * answer cut off mid-sentence — the docked indicator already gone (the server's
 * `stream` row settles on its own) while the transcript kept the stream's last
 * partial segment. Only a reload repaired it.
 *
 * The shape this spec produces, and why each part is needed:
 *
 * 1. the channel must be OPEN once, with frames flowing, before it goes away.
 *    A tab that never connected has missed nothing, and the recovery path
 *    deliberately refuses to act there (that is what protects a send whose
 *    `connect()` is the first dial);
 * 2. it then stays UNREACHABLE for longer than the rest of the run. Closing the
 *    socket repeatedly is not enough: the client re-dials in ~500ms and the
 *    next `message_update` carries the whole accumulated answer, so the drop
 *    never actually loses anything. The socket constructor is replaced for the
 *    window instead, which is the client's own dial path — no test hook exists
 *    in the app, and none is added;
 * 3. the window is released, the client reconnects for real, and the FULL
 *    answer must appear with no reload.
 *
 * `FAKE_OMP_PERSIST=1` makes the scripted child write its turn to the session
 * JSONL the way omp does; without a committed transcript there is nothing for
 * the recovery to read back, and the spec would pass for the wrong reason.
 *
 * WHAT THIS SPEC DOES AND DOES NOT PIN. It is an END-TO-END proof of the
 * user-visible outcome: a turn that finishes while the channel is down ends up
 * complete, with one row and nothing spinning. It is deliberately NOT the
 * discriminator for the recovery path — verified by disabling
 * `useLostRunRecovery` and watching it still pass, because a second, ordinary
 * mechanism (the session-load effect re-running when the URL settles) repairs
 * the transcript in this shape as well. The MECHANISM is pinned at the unit
 * layer, where every branch is driven directly and each one was A/B'd:
 * `client/hooks/chat/omp/reconnect.test.ts` (the trigger conditions, the
 * flicker latch, the spawn-adoption re-mount), `client/hooks/chat/timeline/
 * lost-run.test.ts` (mounted through the real `useSessionLoad`: the partial row
 * is replaced, the placeholder survives until the replacement arrives, an empty
 * read is retried) and `shared/lib/chat/timeline/omp-callbacks.test.ts` (the
 * settle-time read happens once, and only after a loss). Do not "strengthen"
 * this spec by asserting internals: what a browser can see here is the outcome,
 * and the outcome has two ways to arrive.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';
import type { Page } from '@playwright/test';

test.use({ serverEnv: { FAKE_OMP_PERSIST: '1' } });

/** `slow` streams character by character (30ms each), so the turn outlives the
 *  drop window; the padding keeps it running while the channel is gone. */
const PROMPT = `slow delay:200 ${'reconnect-payload '.repeat(8)}`;
/** The whole answer. Only the FULL text proves the turn was recovered — the
 *  partial segment the stream left behind is a prefix of it. */
const FULL_ANSWER = `Response to: ${PROMPT}`;

/** The realtime channel's process-wide state, as this spec reaches it. */
interface RealtimeGlobals {
  __kabmoRealtimeConnection?:
    | { socket?: WebSocket | null; socketCtor?: unknown; status?: string }
    | undefined;
}

/**
 * Wait until the channel is OPEN.
 *
 * Load-bearing, not cosmetic: the recovery acts only on an OPEN → closed
 * transition, because a dial that never opened has no frames to have missed.
 * Taking the channel down while it is still `connecting` is a state the
 * feature deliberately ignores — and it is what this spec did first, which made
 * the assertion look like a product bug (measured: `wasOpen:false` at the drop).
 */
async function waitForChannelOpen(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const host = (globalThis as RealtimeGlobals).__kabmoRealtimeConnection;
    // The client's own STATUS, not `socket.readyState`: the browser flips
    // readyState to OPEN BEFORE it dispatches `open`, so a readyState gate
    // fires while the channel still reads `connecting` — measured as the flake
    // this spec had, where the drop was logged with `wasOpen:false` and the
    // recovery (correctly) refused to act.
    return host?.status === 'open';
  }, undefined, { timeout: 15_000 });
}

/**
 * Take the channel down until `restoreChannel`.
 *
 * The replacement constructor never opens, so every re-dial during the window
 * stays in `connecting` and no frame is delivered — the shape a frozen tab
 * produces. Restoring the real constructor triggers the client's own reconnect,
 * which is the transition the recovery path watches.
 */
async function blockChannel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = (globalThis as RealtimeGlobals).__kabmoRealtimeConnection;
    if (!host) throw new Error('no realtime state: the channel was never dialed');
    // A socket that never opens and never errors: the client keeps believing a
    // dial is in flight, which is exactly a frozen tab's view.
    class DeadSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: unknown = null;
      readyState = 0;
      constructor(public url: string) {}
      close(): void {}
      send(): void {}
    }
    host.socketCtor = DeadSocket;
    // Closing the live socket is what the server's heartbeat teardown does; the
    // re-dial that follows hits the dead constructor.
    host.socket?.close();
  });
}

/** Bring the channel back, which is the transition the recovery watches. */
async function restoreChannel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = (globalThis as RealtimeGlobals).__kabmoRealtimeConnection;
    if (!host) return;
    host.socketCtor = null;
    // The stub is dropped, not closed: `wake()` returns early on a socket still
    // in CONNECTING, and the stub's `close()` is a no-op that would deliver no
    // `onclose` to schedule a retry. Clearing the slot and firing the resume
    // event is the path a returning tab takes.
    host.socket = null;
    window.dispatchEvent(new Event('online'));
  });
}

/**
 * Wait until the SERVER's transcript carries a row matching `match`.
 *
 * A condition, never a duration: the point of the outage specs is that the
 * client missed something the server already recorded, and how long that takes
 * depends on the child's own pace. Reading the transcript through the same
 * `/api/chat/:id` the client uses is also what proves the bytes are on disk
 * rather than in a frame the spec happened to catch.
 */
async function waitForTranscript(
  page: Page,
  match: (rows: { role?: string; toolCalls?: { name?: string }[]; content?: unknown }[]) => boolean,
): Promise<void> {
  await page.waitForFunction(async (source) => {
    const check = new Function('rows', `return (${source})(rows)`) as (rows: unknown[]) => boolean;
    const id = new URL(location.href).searchParams.get('sessionId');
    if (!id) return false;
    const res = await fetch(`/api/chat/${encodeURIComponent(id)}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { session?: { messages?: unknown[] } };
    return check(body.session?.messages ?? []);
  }, match.toString(), { timeout: 30_000 });
}

test.describe('a run that ends while the channel is down', () => {
  test('recovers the whole answer once the channel returns', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-reconnect');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    // The send resolves its cwd from the sidebar's folder list, which loads
    // asynchronously; pressing Enter before that leaves no cwd and the prompt
    // never reaches a child.
    await expect(page.getByText('e2e-reconnect').first()).toBeVisible();
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();

    // A FIRST turn, so the session already has a URL of its own before the
    // interesting one. That is load-bearing and was found the hard way: on a
    // fresh spawn the URL adopts omp's UUID a beat later, the session-load
    // effect re-runs, and its ordinary history read repairs the transcript by
    // itself — which made this spec pass with the recovery disabled (measured).
    // The reported failure is a session the tab already sits on, where no
    // adoption happens and nothing else re-reads.
    await input.fill('warm up');
    await input.press('Enter');
    await expect(page.getByText('Response to: warm up', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#generating-docked-indicator')).toHaveCount(0, { timeout: 30_000 });

    // The turn this spec is about, on a session whose id is already settled.
    await input.fill(PROMPT);
    await input.press('Enter');

    // The answer is streaming: the channel is open and frames are flowing, so
    // what follows is a DROP rather than a tab that never connected. This is
    // the partial segment the recovery has to replace.
    await expect(page.getByText(/Response to: slow/).first()).toBeVisible({ timeout: 30_000 });
    await waitForChannelOpen(page);

    // Down until the SERVER has the whole turn — a condition, not a duration.
    // The answer is ~180 characters at 30ms each, so how long it takes is the
    // child's business; what matters is that its `message_end` and `agent_end`
    // reach a socket nobody is reading.
    await blockChannel(page);
    await waitForTranscript(page, (rows) => rows.some((row) => row.role === 'ai' && String(row.content ?? '').includes('reconnect-payload')));
    await restoreChannel(page);

    // The channel is back. Recovery is the attach probe plus the transcript
    // read, so the full text arrives without a reload.
    await expect(page.getByText(FULL_ANSWER, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // The run is over, so nothing may still be spinning — and the recovered
    // turn must be ONE row, not the partial row beside the committed one.
    await expect(page.getByText(/thinking/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(FULL_ANSWER, { exact: true })).toHaveCount(1);

    workspace.dispose();
  });
});
