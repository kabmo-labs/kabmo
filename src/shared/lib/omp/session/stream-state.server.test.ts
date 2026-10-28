/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stream-status rows: the model a run is served by, and the reads the
 * sidebar makes. The self-heal rules that decide when a row has been abandoned
 * live in `stream-heal.server.test.ts`, beside the module that owns them.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  loadStreamStates,
  loadStreamStatuses,
  markStreamModel,
  markStreamStatus,
} from '@/shared/lib/omp/session/stream-state.server';

/**
 * A budget, and the SHARED isolation helpers — not a hand-rolled teardown.
 *
 * This file used to mkdtemp, point `KABMO_DB_PATH` at it, and close the handle
 * itself. That is the pattern `test-support/isolated-db.ts` exists to replace,
 * and it lost on `windows-latest`: with the runner starved, the two cases before
 * the failure took 1512ms and 4446ms (the same file is a few hundred ms
 * locally), then an `afterEach` burned `removeDir`'s whole 5s retry window on
 * `EBUSY: resource busy or locked` and Bun reported it as "a beforeEach/afterEach
 * hook timed out" and an assertion in the NEXT case reading `undefined`. Two
 * things are wrong with the hand-rolled form and neither is a tuning problem:
 *
 *   - it never AWAITS an open that is still in flight (`getDb()`'s promise), so
 *     the continuation can reach `createDb` after the delete began — while
 *     `removeDir` spins with `Bun.sleepSync`, which blocks the very continuation
 *     that would close the handle;
 *   - it clears `globalThis.__kabmoDb` without marking the slot `disposed`, so a
 *     retired open caches a handle nothing will ever close.
 *
 * `releaseDb` does both (see `closeDb`), and the 30s budget is the same one the
 * canonical-path and git suites state: a retry deadline that equals Bun's 5s
 * hook budget can only ever report the timeout, never the lock.
 */
setDefaultTimeout(30_000);

describe('run model on the stream row', () => {
  beforeEach(async () => {
    // The writes resolve the database; isolated so the real `~/.kabmo` is never
    // opened, and closed before the temp tree is dropped.
    await isolateDb();
  });

  afterEach(async () => {
    await releaseDb();
  });

  test('a dispatch write stores the pair, and a status-only re-mark keeps it', async () => {
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'anthropic', modelId: 'claude' },
    });

    // agent_start / turn_start / message_start / the terminal badge all write
    // the status alone.
    await markStreamStatus('s1', 'finish');
    expect((await loadStreamStates()).s1).toEqual({
      status: 'finish',
      model: { provider: 'anthropic', modelId: 'claude' },
    });
  });

  test('a later run’s model replaces the previous one', async () => {
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    await markStreamStatus('s1', 'stream', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s1?.model).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  test('a row written without a model reports none, and the status view is status-only', async () => {
    await markStreamStatus('s2', 'abort');
    expect((await loadStreamStates()).s2).toEqual({ status: 'abort' });
    expect(await loadStreamStatuses()).toEqual({ s2: 'abort' });
  });

  test('renames the model of a LIVE row, leaving its status and owner alone', async () => {
    // omp's payload-less `model_changed` — a fallback-chain retry swapped the
    // model mid-run, and the indicator must name what the answer came from.
    await markStreamStatus('s1', 'stream', { provider: 'anthropic', modelId: 'claude' });
    await markStreamModel('s1', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'openai', modelId: 'gpt-5' },
    });
  });

  test('never resurrects a row for a run that already ended', async () => {
    // A fallback landing on the run's LAST frame must not put the spinner back:
    // `markStreamStatus(..., 'stream', model)` would upsert one, which is why
    // the rename is a live-only UPDATE.
    await markStreamStatus('s2', 'finish', { provider: 'anthropic', modelId: 'claude' });
    await markStreamModel('s2', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s2).toEqual({
      status: 'finish',
      model: { provider: 'anthropic', modelId: 'claude' },
    });
  });

  test('does nothing for a session with no live row', async () => {
    await markStreamModel('s3', { provider: 'openai', modelId: 'gpt-5' });
    expect((await loadStreamStates()).s3).toBeUndefined();
  });
});
