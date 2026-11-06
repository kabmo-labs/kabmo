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

  test('an aged probe is still returned, labelled, never reported as absent', async () => {
    // The reported bug, one route round: probe a harness, come back later, and
    // the card said `not probed` while the row was still on disk. Measured on a
    // cold process against the real database — `omp-acp` (17 min) answered and
    // `claude` (61 min) read as absent.
    await rememberProbe('claude', probe({ probedAt: Date.now() - PROBE_TTL_MS - 1 }));
    simulateRestart();

    const aged = await freshProbe('claude');
    expect(aged).not.toBeNull();
    expect(aged?.stale).toBe(true);
    expect(aged?.capabilities.agentVersion).toBe('0.100.0');
    expect((await loadProbes()).has('claude')).toBe(true);
  });

  test('a current probe carries no stale flag', async () => {
    await rememberProbe('claude', probe());
    simulateRestart();
    expect((await freshProbe('claude'))?.stale).toBeUndefined();
  });

  test('an aged probe is NOT used to choose a spawn model', async () => {
    // Showing an old answer on a card is honest; ACTING on one is not — a model
    // the agent dropped in the meantime would fail at the first prompt.
    await rememberProbe('claude', probe({ probedAt: Date.now() - PROBE_TTL_MS - 1 }));
    simulateRestart();
    expect(await harnessProbeModels('claude')).toEqual([]);
    // And the record is still there for the card to draw.
    expect(await freshProbe('claude')).not.toBeNull();
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
