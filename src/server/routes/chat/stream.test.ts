/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The simulated stream reports through the SAME row a real run does.
 *
 * The sidebar spinner and the chat's generating indicator read one source —
 * the server's `stream` row — so the MOCK path has to write it or the two
 * surfaces disagree about whether anything is happening. Two failure modes are
 * pinned here, and both were real:
 *
 * - the row was never written at all (`loadSidebarStatus` returned `{}` under
 *   `MOCK=true`), so the indicator had no server answer to read;
 * - the row was written but this process held no RPC run for it, so the
 *   sidebar's self-heal judged it an ORPHAN and cleared the spinner
 *   mid-answer. That is what the `localRuns` claim exists to prevent.
 *
 * The stream is aborted after its first frame rather than drained: the
 * simulated turn is ~15s of real timers, and the terminal write is the same
 * `finally` either way. Every assertion waits on the write's own realtime
 * signal, never a sleep.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadStreamStatuses } from '@/shared/lib/omp/session/stream-state.server';
import { getLiveRunSessionIds } from '@/server/lib/omp/rpc/session-registry';
import { localRuns } from '@/server/lib/omp/session/local-runs.server';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { action } from '@/server/routes/chat/stream';

const savedMock = Bun.env.MOCK;

beforeEach(async () => {
  await isolateDb();
  localRuns().clear();
  Bun.env.MOCK = 'true';
});

afterEach(async () => {
  Bun.env.MOCK = savedMock;
  localRuns().clear();
  await releaseDb();
});

/** Resolve on the next `stream-status` write — the write's own signal. */
function nextStreamStatusWrite(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const off = onRealtimeSignal((event) => {
    if (event.signal !== 'stream-status') return;
    off();
    resolve();
  });
  return promise;
}

describe('simulated stream status', () => {
  test('a simulated run claims the row and reports a terminal badge', async () => {
    const abort = new AbortController();
    const request = new Request('http://localhost/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sim-1', prompt: 'hello' }),
      signal: abort.signal,
    });

    // Armed BEFORE the request: the live row is written at stream start.
    const liveWrite = nextStreamStatusWrite();
    const response = await action({ request, params: {} });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await liveWrite;

    expect((await loadStreamStatuses())['sim-1']).toBe('stream');
    // The claim is what keeps the sidebar's self-heal from reading this row as
    // an orphan: no omp child exists behind it.
    expect(getLiveRunSessionIds().has('sim-1')).toBe(true);

    // Abort: the run's terminal write is the same one a natural end performs.
    const terminalWrite = nextStreamStatusWrite();
    abort.abort();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await terminalWrite;

    expect((await loadStreamStatuses())['sim-1']).toBe('abort');
    // Released with the run, or the next heal would keep a dead session "live".
    expect(getLiveRunSessionIds().has('sim-1')).toBe(false);
  }, 20_000);

  test('real mode refuses the simulated path outright', async () => {
    Bun.env.MOCK = 'false';
    const request = new Request('http://localhost/api/chat/stream', { method: 'POST' });
    const response = await action({ request, params: {} });
    expect(response.status).toBe(400);
  });
});
