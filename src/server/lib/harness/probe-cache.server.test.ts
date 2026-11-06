/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A probe must SURVIVE A RESTART.
 *
 * The bug this pins, reported by a user and reproducible in one step: press
 * **Check status** on a harness, watch it turn `ready`, restart Kabmo (or let
 * `bun --hot` reload during development), open Settings again — `not probed`.
 *
 * The cause was that the cache was process-scoped: a `Map` on `globalThis` and
 * nothing else. A probe is a fact about the INSTALLED BINARY, not about the
 * process that asked, so the record now lives in `harness_probes` and memory is
 * only the fast layer in front of it.
 *
 * The cases here EMPTY the memory map to simulate a restart — that is the whole
 * difference, so clearing it is what the assertions turn on.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import {
  forgetProbe,
  freshProbe,
  harnessProbeModels,
  loadProbes,
  PROBE_TTL_MS,
  probes,
  rememberProbe,
} from '@/server/lib/harness/probe-cache.server';

beforeEach(async () => {
  await isolateDb();
  probes().clear();
});

afterEach(async () => {
  await releaseDb();
  probes().clear();
});

afterAll(async () => {
  await releaseDb();
});

function probe(overrides: Partial<HarnessProbe> = {}): HarnessProbe {
  return {
    harness: 'claude',
    capabilities: {
      configModel: 5, configThinking: 6, configMode: 5, modeValues: ['plan'],
      loadSession: true, listSessions: true, forkSession: true, deleteSession: false,
      resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
      agentVersion: '0.100.0',
    },
    models: [{ value: 'opus', name: 'Opus' }, { value: 'sonnet', name: 'Sonnet' }],
    thinking: [], modes: [], probedAt: Date.now(),
    ...overrides,
  };
}

/** The only thing a restart changes: the in-memory layer. */
function simulateRestart(): void {
  probes().clear();
}

describe('a probe survives a restart', () => {
  test('a remembered probe is still there after the memory cache is emptied', async () => {
    await rememberProbe('claude', probe());
    expect((await freshProbe('claude'))?.capabilities.configModel).toBe(5);

    simulateRestart();
    const after = await freshProbe('claude');
    expect(after?.capabilities.configModel).toBe(5);
    expect(after?.capabilities.agentVersion).toBe('0.100.0');
    expect(after?.models.map((model) => model.value)).toEqual(['opus', 'sonnet']);
  });

  test('the whole catalog is read back in ONE call', async () => {
    await rememberProbe('claude', probe());
    await rememberProbe('codex', probe({ harness: 'codex', models: [{ value: 'gpt', name: 'GPT' }] }));
    simulateRestart();

    const all = await loadProbes();
    expect([...all.keys()].sort()).toEqual(['claude', 'codex']);
    expect(all.get('codex')?.models[0].value).toBe('gpt');
  });

  test('a spawn resolves its configured default model from the stored probe', async () => {
    // The other half of the bug: the spawn used to read an empty memory map after
    // a restart, so a harness's configured default model silently fell through to
    // the agent's own preference.
    await rememberProbe('claude', probe());
    simulateRestart();
    expect(await harnessProbeModels('claude')).toHaveLength(2);
  });

  test('forgetting removes it from disk, so a changed launch line cannot reuse it', async () => {
    await rememberProbe('claude', probe());
    await forgetProbe('claude');
    simulateRestart();
    expect(await freshProbe('claude')).toBeNull();
    expect(await harnessProbeModels('claude')).toEqual([]);
  });

  test('a probe older than the TTL is not evidence any more', async () => {
    // An update replaces the binary the probe described, so a stale row is read
    // as absent rather than as a stale truth.
    await rememberProbe('claude', probe({ probedAt: Date.now() - PROBE_TTL_MS - 1 }));
    simulateRestart();
    expect(await freshProbe('claude')).toBeNull();
    expect((await loadProbes()).has('claude')).toBe(false);
  });

  test('re-probing REPLACES the row rather than piling up', async () => {
    await rememberProbe('claude', probe());
    await rememberProbe('claude', probe({ models: [{ value: 'haiku', name: 'Haiku' }] }));
    simulateRestart();

    expect((await harnessProbeModels('claude')).map((model) => model.value)).toEqual(['haiku']);
    expect((await loadProbes()).size).toBe(1);
  });

  test('a harness never probed stays absent, not empty-but-present', async () => {
    await rememberProbe('claude', probe());
    simulateRestart();
    expect(await freshProbe('cursor')).toBeNull();
    expect((await loadProbes()).has('cursor')).toBe(false);
  });
});
