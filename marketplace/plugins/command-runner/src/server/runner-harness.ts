/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness the registry's suites share: a registry whose host calls are
 * recorded instead of sent, and a way to wait for a REAL process to reach a
 * state.
 *
 * Extracted when `runner.test.ts` crossed the file ceiling with a second subject
 * (executable resolution) beside the first (the run lifecycle). Both suites drive
 * the same class against real processes, so the alternative — two copies of
 * `makeRegistry` and `waitFor` — would let the two drift and would hide which
 * one a failing assertion came from.
 */

import { expect } from 'bun:test';

import { RunRegistry } from './runner';
import { scopeKeyOf } from './run-store';
import type { RunnerState } from '../protocol';

/** The scope every test run is recorded against. */
export const SCOPE = scopeKeyOf('/ws', '.');

/** A registry whose publish/log/setting calls are recorded instead of sent. */
export function makeRegistry(
  settings: Record<string, unknown> = {},
  env?: Record<string, string | undefined>,
) {
  const published: RunnerState[] = [];
  const logs: string[] = [];
  const registry = new RunRegistry({
    publish: (state) => published.push(state),
    log: (message) => logs.push(message),
    setting: async <T extends string | number | boolean>(key: string) => settings[key] as T | undefined,
    ...(env ? { env } : {}),
  });
  return { registry, published, logs };
}

/**
 * Wait for a condition, so a test never sleeps for a FIXED time.
 *
 * The clock is real here on purpose, and this is the documented exception:
 * every condition below is "an actual OS process reached a state" — a `sleep 30`
 * child that the group kill reaped, a pipe that drained. Fake timers cannot
 * advance a real process, and awaiting the registry's own promise is not
 * possible because it deliberately keeps no per-run promise (a panel reads state,
 * it does not await a run). The poll interval is 10 ms and the bound is generous,
 * so a pass costs milliseconds and a failure names the condition.
 */
export async function waitFor(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (done()) return;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, 10);
    await gate.promise;
  }
}

/** The run a registry holds, by its only id. */
export function onlyRun(state: RunnerState) {
  expect(state.runs).toHaveLength(1);
  return state.runs[0];
}
