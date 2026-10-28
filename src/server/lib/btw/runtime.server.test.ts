/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `BtwRuntime.retarget` — the path that makes a side question follow the chat's
 * model and thinking selector.
 *
 * A live child keeps the model it was SPAWNED with, so a chat that switched
 * model between two side questions would otherwise be answered by the stale one.
 * omp's side turn reads `request.session.model` per run; this is the equivalent,
 * and it has to be a no-op when the values already match or every question would
 * spend two RPC round-trips re-sending what the child already runs.
 *
 * The child is a real `RpcProcess` here (no omp binary is spawned): only the
 * command surface is replaced, so the assertions are on the actual commands the
 * runtime would put on the wire.
 */

import { describe, expect, test } from 'bun:test';
import { BtwRuntime } from '@/server/lib/btw/runtime.server';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import type { BtwFrame } from '@/shared/types';

interface SentCommand {
  type: string;
  [key: string]: unknown;
}

/** A runtime whose child is alive and records every command sent to it. */
function makeRuntime(options: { alive: boolean }): { runtime: BtwRuntime; sent: SentCommand[]; setState: (state: unknown) => void } {
  const sent: SentCommand[] = [];
  let state: unknown = { model: { provider: 'kenari', id: 'deepseek-v4' }, thinkingLevel: 'high' };
  const proc = {
    get isAlive() {
      return options.alive;
    },
    async sendCommand(command: SentCommand) {
      sent.push(command);
      return command.type === 'get_state' ? state : {};
    },
    sendFrame: () => {},
    onFrame: () => () => {},
    dispose: async () => {},
  };
  const runtime = new BtwRuntime(
    {
      topicId: 'topic',
      sessionId: 'session',
      parentSessionFile: '/tmp/parent.jsonl',
      cwd: '/tmp',
      model: { provider: 'kenari', id: 'deepseek-v4' },
      thinkingLevel: 'high',
    },
    { publish: (_frame: BtwFrame) => {}, stateChanged: () => {} },
  );
  // `proc` is the private field the runtime reads; the cast is the seam that
  // keeps this a unit test instead of a spawned-child integration test.
  (runtime as unknown as { proc: unknown }).proc = proc;
  return {
    runtime,
    sent,
    setState: (next) => {
      state = next;
    },
  };
}

describe('BtwRuntime.start', () => {
  test('reuses the live child instead of spawning a second one', async () => {
    const { runtime } = makeRuntime({ alive: true });
    // The seam this suite installs, read back as the type `start` returns.
    const proc = (runtime as unknown as { proc: RpcProcess }).proc;

    // A live child is returned as-is; `spawnChild` is never reached (it would
    // throw here, since no omp binary is configured for this unit test).
    expect(await runtime.start()).toBe(proc);
  });
});

describe('BtwRuntime.retarget', () => {
  test('re-sends both values when the chat moved on', async () => {
    const { runtime, sent } = makeRuntime({ alive: true });
    // Seed what the child currently reports (as `captureModel` would).
    await runtime.retarget({ provider: 'kenari', id: 'deepseek-v4' }, 'high');
    sent.length = 0;

    await runtime.retarget({ provider: 'anthropic', id: 'claude-sonnet-5' }, 'low');

    expect(sent.map((command) => command.type)).toEqual(['set_model', 'set_thinking_level']);
    expect(sent[0]).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(sent[1]).toMatchObject({ level: 'low' });
  });

  test('sends nothing when the child already runs them', async () => {
    const { runtime, sent } = makeRuntime({ alive: true });
    await runtime.retarget({ provider: 'kenari', id: 'deepseek-v4' }, 'high');
    sent.length = 0;

    await runtime.retarget({ provider: 'kenari', id: 'deepseek-v4' }, 'high');

    expect(sent).toHaveLength(0);
  });

  test('records the values for the next spawn when no child is alive', async () => {
    const { runtime, sent } = makeRuntime({ alive: false });

    await runtime.retarget({ provider: 'anthropic', id: 'claude-sonnet-5' }, 'auto');

    expect(sent).toHaveLength(0);
    // The spawn reads these; nothing was sent to a dead process.
    expect((runtime as unknown as { context: { model?: unknown; thinkingLevel?: string } }).context.model)
      .toEqual({ provider: 'anthropic', id: 'claude-sonnet-5' });
    expect((runtime as unknown as { context: { thinkingLevel?: string } }).context.thinkingLevel).toBe('auto');
  });

  test('carries `auto` through to the child rather than dropping it', async () => {
    const { runtime, sent } = makeRuntime({ alive: true });
    await runtime.retarget(undefined, 'high');
    sent.length = 0;

    await runtime.retarget(undefined, 'auto');

    expect(sent.map((command) => command.type)).toEqual(['set_thinking_level']);
    expect(sent[0]).toMatchObject({ level: 'auto' });
  });
});
