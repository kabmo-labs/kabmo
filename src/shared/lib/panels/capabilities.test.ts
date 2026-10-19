/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The capability table, and the refusal it drives.
 *
 * Two properties, and the second is the one that is easy to get wrong:
 *
 * - **A capability the host provides is admitted.** The table named only
 *   `panel` for a long time while a plugin's server half, storage, RPC, realtime
 *   and settings had all shipped — so a manifest requiring any of them was
 *   refused BY NAME for something the host did perfectly well. The rows are
 *   asserted individually rather than as a count, because the failure is a
 *   specific row going missing, not the list shrinking.
 * - **A capability the host does NOT provide still refuses.** That is the whole
 *   reason the table exists: a plugin admitted on a requirement nobody checked
 *   would fail at runtime with no reason a user could act on.
 *
 * `describeIncompatibility` is driven directly: it is the pure decision the scan
 * calls, and testing it through the scan would need a plugin directory, a
 * manifest file and a build.
 */

import { describe, expect, test } from 'bun:test';
import { HOST_CAPABILITIES, missingCapabilities } from '@/shared/lib/panels/capabilities';
import { describeIncompatibility } from '@/server/lib/panels/compat.server';
import type { PanelPluginManifest } from '@/shared/types';

const RUNNING = { kabmo: '1.0.0', pluginSdk: '1.0.0' };

/** A manifest that is compatible but for the field a test is about. */
function manifest(overrides: Partial<PanelPluginManifest> = {}): PanelPluginManifest {
  return { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js', ...overrides };
}

describe('HOST_CAPABILITIES', () => {
  test('names the shipped capabilities, each individually', () => {
    // One assertion per row: a missing row is the bug, not a changed length.
    for (const capability of ['panel', 'server', 'storage', 'rpc', 'realtime', 'settings', 'repo-scope']) {
      expect(HOST_CAPABILITIES).toContain(capability);
    }
  });

  test('a capability nobody provides is still reported', () => {
    expect(missingCapabilities(['panel', 'teleport'])).toEqual(['teleport']);
  });

  test('every shipped capability is satisfied, so nothing is refused by mistake', () => {
    expect(missingCapabilities(HOST_CAPABILITIES)).toEqual([]);
  });
});

describe('describeIncompatibility', () => {
  test('a compatible manifest is admitted', () => {
    expect(describeIncompatibility(manifest(), RUNNING)).toBeNull();
  });

  test('a shipped capability is admitted', () => {
    // The bug this pins: `capabilities: ['server']` used to be refused with
    // "which this Kabmo does not provide" over a feature that shipped.
    expect(describeIncompatibility(manifest({ capabilities: ['server'] }), RUNNING)).toBeNull();
    expect(describeIncompatibility(manifest({ capabilities: ['repo-scope'] }), RUNNING)).toBeNull();
  });

  test('an unprovided capability is refused by name', () => {
    const reason = describeIncompatibility(manifest({ capabilities: ['teleport'] }), RUNNING);
    expect(reason).toContain('teleport');
    expect(reason).toContain('does not provide');
  });

  test('an engine range that does not match is refused, naming both sides', () => {
    const reason = describeIncompatibility(manifest({ engines: { kabmo: '^9.0.0' } }), RUNNING);
    expect(reason).toContain('kabmo');
    expect(reason).toContain('1.0.0');
  });
});
