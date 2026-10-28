/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The SWEEPS: every way a run ends other than the command finishing.
 *
 * Split from `runner.test.ts` when that file crossed the 350-line ceiling, and
 * the seam is real: `runner.test.ts` is about ONE run's lifecycle (spawn, output,
 * exit code), this file is about the SET — a repo switch, a repeat call, a
 * disposal. The registry is shared, so the helpers live here too.
 *
 * `stop-others` is defined by the scope it is HANDED rather than by a diff, which
 * is what makes the repo-switch watcher able to fire on every notification: the
 * idempotence test below is the property that depends on it.
 *
 * Real processes throughout — a fake `Bun.spawn` would prove nothing about a
 * group kill.
 */

import { describe, expect, test } from 'bun:test';

import { RunRegistry } from './runner';
import { scopeKeyOf } from './run-store';
import type { RunnerState } from '../protocol';

/** A registry whose publish/log/setting calls are recorded instead of sent. */
function makeRegistry(settings: Record<string, unknown> = {}) {
  const published: RunnerState[] = [];
  const logs: string[] = [];
  const registry = new RunRegistry({
    publish: (state) => published.push(state),
    log: (message) => logs.push(message),
    setting: async <T extends string | number | boolean>(key: string) => settings[key] as T | undefined,
  });
  return { registry, published, logs };
}

/** Wait for a condition. Real time on purpose: the subject is an OS process. */
async function waitFor(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (done()) return;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, 10);
    await gate.promise;
  }
}

const SCOPE = scopeKeyOf('/ws', '.');

/** The run a registry holds, by its only id. */
function onlyRun(state: RunnerState) {
  expect(state.runs).toHaveLength(1);
  return state.runs[0];
}

describe('the sweeps', () => {
  test('stopOthers kills only the OTHER scope, for this session', async () => {
    const { registry } = makeRegistry();
    const spawn = (id: string, scopeKey: string, sessionId: string | null) =>
      registry.start({
        id,
        sessionId,
        scopeKey,
        commandId: 'Makefile#make:slow',
        file: 'Makefile',
        cwd: process.cwd(),
        argv: ['sh', '-c', 'sleep 30'],
        label: `sleep ${id}`,
        background: true,
      });

    const other = scopeKeyOf('/ws', 'projects/alpha');
    await spawn('mine', SCOPE, 's1');
    await spawn('theirs', other, 's1');
    await spawn('other-session', other, 's2');

    // Switching to `other` in s1 must kill `mine` and leave the rest.
    const result = await registry.stopOthers('s1', other);
    expect(result.stopped).toBe(1);

    const byId = new Map(registry.state().runs.map((run) => [run.id, run]));
    await waitFor(() => byId.get('mine')!.status !== 'running');
    expect(byId.get('theirs')!.status).toBe('running');
    // Another session legitimately holds another repo, so its run survives.
    expect(byId.get('other-session')!.status).toBe('running');

    await registry.dispose();
  }, 30_000);

  test('stopOthers is idempotent: the same scope twice kills nothing more', async () => {
    const { registry } = makeRegistry();
    await registry.start({
      id: 'keep',
      sessionId: 's1',
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'Makefile',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'sleep 30'],
      label: 'sleep',
      background: true,
    });

    // The watcher calls this on every notification, so a no-op must stay a no-op.
    expect(await registry.stopOthers('s1', SCOPE)).toEqual({ stopped: 0 });
    expect(await registry.stopOthers('s1', SCOPE)).toEqual({ stopped: 0 });
    expect(onlyRun(registry.state()).status).toBe('running');

    await registry.dispose();
  }, 20_000);

  test('dispose kills everything, which is what a reload and a shutdown need', async () => {
    const { registry } = makeRegistry();
    await registry.start({
      id: 'doomed',
      sessionId: null,
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'Makefile',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'sleep 30'],
      label: 'sleep',
      background: true,
    });

    await registry.dispose();

    // The registry is empty and nothing is left running.
    expect(registry.state().runs).toEqual([]);
    expect(registry.runningCount).toBe(0);
  }, 20_000);

});
