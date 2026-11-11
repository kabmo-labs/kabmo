/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `get_state` probe that keeps the run row's model true.
 *
 * The repair half is what these cases pin: a live row can exist with no pair at
 * all, and a wrapper that already knew the pair used to skip the write — the
 * docked indicator then read `Loading…` for the whole answer.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { syncRunModel, type RunModelHost } from '@/server/lib/omp/rpc/run-model';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import type { RpcSessionState } from '@/server/lib/omp/rpc/constants';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loadStreamStates, markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';

/** A host whose probe answers with the given state, or rejects. */
function makeHost(
  answer: RpcSessionState | Error,
  runModel: RunModelHost['runModel'] = null,
): RunModelHost {
  return {
    sessionId: 's1',
    runModel,
    proc: {
      sendCommand: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    } as unknown as RpcProcess,
  };
}

function state(model?: { provider: string; id: string }): RpcSessionState {
  return {
    sessionId: 's1',
    sessionFile: '/tmp/s.jsonl',
    isStreaming: true,
    isSettled: false,
    isCompacting: false,
    ...(model ? { model } : {}),
  } as RpcSessionState;
}

/**
 * Flush the probe's fire-and-forget chain to completion.
 *
 * A database round trip is the ordering point: a write the probe queued ahead
 * of this read has landed by the time it resolves, so the assertions below are
 * about the write, not about how long the event loop took.
 */
async function settleProbe(): Promise<void> {
  for (let round = 0; round < 3; round += 1) await loadStreamStates();
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('syncRunModel repairs the live row', () => {
  test('fills a row that carries no model, even when the wrapper already knew the pair', async () => {
    await markStreamStatus('s1', 'stream');
    const host = makeHost(state({ provider: 'anthropic', id: 'claude' }), {
      provider: 'anthropic',
      modelId: 'claude',
    });
    // The repair is a change, so the row write raises `stream-status` after the
    // UPDATE lands — the completion event to await.
    const { promise, resolve } = Promise.withResolvers<void>();
    const off = onRealtimeSignal((event) => {
      if (event.signal === 'stream-status') resolve();
    });
    try {
      syncRunModel(host);
      await promise;
    } finally {
      off();
    }

    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'anthropic', modelId: 'claude' },
    });
  });

  test('leaves a terminal row alone', async () => {
    await markStreamStatus('s1', 'finish');
    syncRunModel(makeHost(state({ provider: 'anthropic', id: 'claude' })));
    await settleProbe();

    // The fallback probe fires on the run's last frame too; it must not name a
    // model on a badge that means "the run is over".
    expect((await loadStreamStates()).s1).toEqual({ status: 'finish' });
  });

  test('keeps the last known pair when the probe fails', async () => {
    await markStreamStatus('s1', 'stream', { provider: 'openai', modelId: 'gpt-5' });
    syncRunModel(makeHost(new Error('timeout')));
    await settleProbe();

    expect((await loadStreamStates()).s1).toEqual({
      status: 'stream',
      model: { provider: 'openai', modelId: 'gpt-5' },
    });
  });
});
