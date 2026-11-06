/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saving a harness's config must not throw away what the last probe measured —
 * except when it must.
 *
 * The distinction is the whole rule, and it was wrong in the first version:
 * every save dropped the cached probe, so storing a default model collapsed the
 * provider/model PICKERS back into free-text fields. Measured in a browser:
 * probe `command-code` (96 models, provider dropdown populated), press Save with
 * an unchanged command, and the dropdowns were gone — the form the user had just
 * improved was replaced by one where every value must be typed from memory.
 *
 * Only `command` and `env` are what a probe measured. A default model, provider,
 * thinking level or mode does not change what the agent OFFERS.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { EMPTY_HARNESS_CONFIG, parseHarnessConfig } from '@/shared/lib/harness/config';
import {
  loadHarnessConfig,
  probeInvalidatedBy,
  saveHarnessConfig,
} from '@/server/lib/harness/config.server';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(async () => {
  await releaseDb();
});

/** The rule is the ROUTE's own function, imported above — a copy here would let
 *  the test and the product disagree about which fields count. */

describe('which config writes invalidate a probe', () => {
  test('a defaults-only save leaves the command and env untouched', async () => {
    await saveHarnessConfig('command-code', { ...EMPTY_HARNESS_CONFIG, command: 'cmd acp', env: 'A=1' });
    const before = await loadHarnessConfig('command-code');

    await saveHarnessConfig('command-code', {
      ...before, provider: 'claude-sonnet-5', thinking: 'high',
    });
    const after = await loadHarnessConfig('command-code');

    expect(probeInvalidatedBy(before, after)).toBe(false);
    // The defaults really did land, so the case is not passing by doing nothing.
    expect(after.provider).toBe('claude-sonnet-5');
    expect(after.thinking).toBe('high');
  });

  test('changing the launch command DOES invalidate it', async () => {
    await saveHarnessConfig('claude', { ...EMPTY_HARNESS_CONFIG, command: 'cmd acp' });
    const before = await loadHarnessConfig('claude');
    await saveHarnessConfig('claude', { ...before, command: 'other acp' });
    const after = await loadHarnessConfig('claude');

    expect(probeInvalidatedBy(before, after)).toBe(true);
  });

  test('changing the env DOES invalidate it', async () => {
    // Env is the provider/credential switch an ACP agent honours, so it can
    // point the same binary at a different catalog entirely.
    await saveHarnessConfig('claude', { ...EMPTY_HARNESS_CONFIG, env: 'A=1' });
    const before = await loadHarnessConfig('claude');
    await saveHarnessConfig('claude', { ...before, env: 'A=2' });
    const after = await loadHarnessConfig('claude');

    expect(probeInvalidatedBy(before, after)).toBe(true);
  });

  test('the stored config survives the round trip the route compares', async () => {
    // The route compares what it READ against what it parsed from the body; a
    // normalisation that changed whitespace would invalidate a probe on every
    // save. `parseHarnessConfig` is identity over its own output.
    const saved = parseHarnessConfig({ command: 'cmd acp', env: 'A=1' });
    await saveHarnessConfig('antigravity', saved);
    const read = await loadHarnessConfig('antigravity');
    expect(read.command).toBe(saved.command);
    expect(read.env).toBe(saved.env);
  });
});
