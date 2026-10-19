/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import { composeShellFailureReason, shellBundleRefusal } from '@/server/plugins/shell.server';
import { SPAWN_CLIFF, hasDescriptorHeadroom } from '@/server/lib/lifecycle/fd-pressure';

const FULL_TABLE = { open: 10_240, highest: 10_239, limit: SPAWN_CLIFF, nearCliff: true };
const ROOMY_TABLE = { open: 400, highest: 402, limit: SPAWN_CLIFF, nearCliff: false };

/**
 * The message Bun actually produced on the real condition, kept verbatim: it
 * names a missing dependency and is what sent the reader to `bun install`.
 */
const MISLEADING_DETAIL = 'runtime.ts:32:25  Could not resolve: "@kabmo-labs/plugin-sdk/app". Maybe you need to "bun install"?';

describe('composeShellFailureReason', () => {
  test('leads with descriptor exhaustion, not the dependency it blames', () => {
    const reason = composeShellFailureReason({
      status: 500,
      detail: MISLEADING_DETAIL,
      pressure: FULL_TABLE,
    });

    // The real cause is the first thing said, and the wrong fix is never
    // repeated as an instruction.
    expect(reason.indexOf('out of file descriptors')).toBeLessThan(reason.indexOf('Could not resolve'));
    expect(reason).toContain('restart the instance');
    // The build detail survives as evidence, labelled as the consequence.
    expect(reason).toContain('consequence of the same exhaustion');
    expect(reason).toContain('@kabmo-labs/plugin-sdk/app');
  });

  test('blames the bundle only when the table has room', () => {
    const reason = composeShellFailureReason({
      status: 500,
      detail: MISLEADING_DETAIL,
      pressure: ROOMY_TABLE,
    });

    expect(reason).toContain('The client bundle does not build:');
    expect(reason).not.toContain('out of file descriptors');
  });

  test('still explains a cached failure when nothing is exhausted and the build is clean', () => {
    const reason = composeShellFailureReason({ status: 200, markupInvalid: true, detail: null, pressure: null });

    expect(reason).toContain('cached');
    expect(reason).toContain('Restart the server');
  });

  test('names exhaustion even when the probe could not report a build error', () => {
    // The real condition: at the cliff Bun.build fails before it can log a
    // position, so `describeShellBuildFailure` returns null and the status
    // alone would have been the whole answer.
    const reason = composeShellFailureReason({ status: 500, detail: null, pressure: FULL_TABLE });

    expect(reason).toContain('out of file descriptors');
    expect(reason).toContain('Shell route answered 500.');
  });
});

describe('hasDescriptorHeadroom', () => {
  test('permits work when the probe cannot answer, rather than guessing', () => {
    expect(hasDescriptorHeadroom(null, 100_000)).toBe(true);
  });

  test('reserves room for a burst of spawns beyond the work itself', () => {
    // Exactly the work plus the reserve fits; one descriptor less does not.
    expect(hasDescriptorHeadroom({ open: 1000, highest: 1000, limit: 2024, nearCliff: false }, 0)).toBe(true);
    expect(hasDescriptorHeadroom({ open: 1001, highest: 1001, limit: 2024, nearCliff: false }, 0)).toBe(false);
  });
});

describe('shellBundleRefusal', () => {
  test('refuses a dev bundle once the table cannot hold one', () => {
    // 61440-entry table with 60000 open: a 3600-descriptor bundle plus the
    // spawn reserve no longer fits, so the build must not be attempted.
    const tight = { open: 60_000, highest: 60_000, limit: 61_440, nearCliff: true };
    const refusal = shellBundleRefusal(tight);

    if (Bun.env.NODE_ENV === 'production') {
      // Production builds ahead of time and holds no graph, so the count is not
      // what decides whether it can serve.
      expect(refusal).toBeNull();
      return;
    }
    expect(refusal).toContain('out of file descriptors');
    expect(refusal).toContain('NOT rebuilt');
  });

  test('allows the bundle on a healthy table', () => {
    expect(shellBundleRefusal({ open: 3354, highest: 3354, limit: 61_440, nearCliff: false })).toBeNull();
  });
});
