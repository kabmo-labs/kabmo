/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-harness config as the SPAWN sees it: the user's override merged over
 * the build's launch table.
 *
 * The merge is the whole point, and both halves of it matter:
 *
 *  - an empty command means the TABLE's line, so an install that never opened
 *    the form spawns exactly what it always did;
 *  - an env override is UNIONED with the table's, not substituted — the table's
 *    env carries what the adapter needs to run at all (`CODEX_PATH`), and
 *    replacing it would break a working harness by setting one unrelated
 *    variable.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { EMPTY_HARNESS_CONFIG, parseHarnessConfig } from '@/shared/lib/harness/config';
import { loadHarnessConfig, resolveLaunch, saveHarnessConfig } from '@/server/lib/harness/config.server';
import { HARNESS_LAUNCH } from '@/server/lib/harness/launch';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(async () => {
  await releaseDb();
});

describe('harness config storage', () => {
  test('an untouched harness reads as empty, and the table line is used', async () => {
    const config = await loadHarnessConfig('antigravity');
    expect(config).toEqual(EMPTY_HARNESS_CONFIG);
    expect(resolveLaunch('antigravity', config).command).toEqual(HARNESS_LAUNCH.antigravity!.command);
  });

  test('a saved config is what the next read returns', async () => {
    await saveHarnessConfig('antigravity', {
      ...EMPTY_HARNESS_CONFIG,
      command: '"/opt/my tools/agy" acp',
      provider: 'google',
      thinking: 'high',
    });

    const config = await loadHarnessConfig('antigravity');
    expect(config.command).toBe('"/opt/my tools/agy" acp');
    expect(config.provider).toBe('google');

    // The override reaches the spawn shape, quoted path intact.
    expect(resolveLaunch('antigravity', config).command).toEqual(['/opt/my tools/agy', 'acp']);
  });

  test('saving an empty config DELETES the row rather than storing blanks', async () => {
    await saveHarnessConfig('claude', { ...EMPTY_HARNESS_CONFIG, mode: 'plan' });
    await saveHarnessConfig('claude', { ...EMPTY_HARNESS_CONFIG });

    const config = await loadHarnessConfig('claude');
    expect(parseHarnessConfig(config)).toEqual(EMPTY_HARNESS_CONFIG);
    expect(config.mode).toBe('');
  });

  test('configs are per harness, so saving one leaves another alone', async () => {
    await saveHarnessConfig('claude', { ...EMPTY_HARNESS_CONFIG, thinking: 'low' });
    await saveHarnessConfig('codex', { ...EMPTY_HARNESS_CONFIG, thinking: 'high' });

    expect((await loadHarnessConfig('claude')).thinking).toBe('low');
    expect((await loadHarnessConfig('codex')).thinking).toBe('high');
  });
});

describe('resolveLaunch', () => {
  test('an env override is UNIONED with the table, never substituted', () => {
    // `codex` ships `CODEX_PATH` in its table env; dropping it would break a
    // harness that worked before the user set one unrelated variable.
    const tableEnv = HARNESS_LAUNCH.codex?.env;
    const launch = resolveLaunch('codex', { ...EMPTY_HARNESS_CONFIG, env: 'MY_VAR=1' });
    expect(launch.env?.MY_VAR).toBe('1');
    for (const key of Object.keys(tableEnv ?? {})) {
      expect(launch.env?.[key]).toBe(tableEnv?.[key]);
    }
  });

  test('a malformed env line throws with the line named, not silently skipped', () => {
    expect(() => resolveLaunch('claude', { ...EMPTY_HARNESS_CONFIG, env: 'NOT_AN_ASSIGNMENT' }))
      .toThrow(/NOT_AN_ASSIGNMENT/);
  });

  test('the built-in transport cannot be launched, and says so', () => {
    expect(() => resolveLaunch('omp-rpc', EMPTY_HARNESS_CONFIG)).toThrow(/built in/);
  });

  test('a harness the table does not know is an error, not an empty session', () => {
    // `dsh` has a line; the check is the SHAPE of the failure, which must throw
    // rather than spawn nothing.
    expect(() => resolveLaunch('dsh', EMPTY_HARNESS_CONFIG)).not.toThrow();
  });
});
