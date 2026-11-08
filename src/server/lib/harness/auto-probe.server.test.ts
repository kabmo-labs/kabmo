/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The boot pass: every restart re-checks the harnesses the user keeps ON.
 *
 * The requirement is a ROSTER question before it is a probe question, so the
 * cases here hold the selection: off means not spawned, built-in means not
 * spawned, a missing launch command means not spawned. Only then "and the answer
 * is stored" — the settings card reads the cache, not this pass.
 *
 * The seams (`ids`, `available`, `probe`) exist for these tests: a real probe
 * spawns an agent, and a suite that depends on which binaries a runner happens to
 * have is a suite that fails only on CI. The production defaults are the real
 * catalog, `commandAvailable` and `probeWithConfig`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  autoProbeTargets,
  runAutoProbe,
  type AutoProbeOptions,
} from '@/server/lib/harness/auto-probe.server';
import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import { loadProbes, probes } from '@/server/lib/harness/probe-cache.server';
import { saveHarnessEnabled } from '@/server/lib/harness/enabled.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';

function probe(id: HarnessId): HarnessProbe {
  return {
    harness: id,
    capabilities: {
      configModel: 5, configThinking: 6, configMode: 5, modeValues: ['plan'],
      loadSession: true, listSessions: true, forkSession: true, deleteSession: false,
      resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
      agentVersion: '1.0.0',
    },
    models: [], thinking: [], modes: [], probedAt: Date.now(),
  };
}

const allAvailable = (): boolean => true;

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

describe('autoProbeTargets', () => {
  test('skips a switched-off harness and the built-in transport', async () => {
    await saveHarnessEnabled('claude', false);
    const checked: string[] = [];
    const targets = await autoProbeTargets({
      ids: ['omp-rpc', 'omp-acp', 'claude'],
      available: (id) => {
        checked.push(id);
        return true;
      },
    });
    expect(targets).toEqual(['omp-acp']);
    // The built-in transport never reaches the availability check: there is no
    // agent behind it to ask about.
    expect(checked).toEqual(['omp-acp']);
  });

  test('skips a harness whose launch command is not resolvable', async () => {
    const targets = await autoProbeTargets({
      ids: ['omp-acp', 'claude', 'cursor'],
      available: (id) => id === 'omp-acp',
    });
    expect(targets).toEqual(['omp-acp']);
  });
});

describe('runAutoProbe', () => {
  test('probes every target and stores each answer', async () => {
    const seen: HarnessId[] = [];
    const options: AutoProbeOptions = {
      ids: ['omp-acp', 'claude'],
      cwd: '/tmp',
      available: allAvailable,
      probe: async (id, cwd) => {
        expect(cwd).toBe('/tmp');
        seen.push(id);
        return probe(id);
      },
    };
    const outcome = await runAutoProbe(options);
    expect(outcome.failed).toEqual([]);
    expect(outcome.probed).toEqual(['omp-acp', 'claude']);
    expect(seen).toEqual(['omp-acp', 'claude']);
    expect((await loadProbes()).get('claude')?.capabilities.agentVersion).toBe('1.0.0');
  });

  test('a probe that throws is reported and does not stop the pass', async () => {
    const outcome = await runAutoProbe({
      ids: ['omp-acp', 'claude'],
      available: allAvailable,
      probe: async (id) => {
        if (id === 'omp-acp') throw new Error('boom');
        return probe(id);
      },
    });
    expect(outcome.failed).toEqual([{ id: 'omp-acp', error: 'boom' }]);
    expect(outcome.probed).toEqual(['claude']);
    expect(probes().has('omp-acp')).toBe(false);
    expect(probes().has('claude')).toBe(true);
  });
});
