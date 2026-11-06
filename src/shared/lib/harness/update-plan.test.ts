/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which parts of a harness an update moves.
 *
 * The reported defect: pressing Update on `claude` ran an npm install AND
 * `claude update` every time, so an adapter that was already current was
 * reinstalled and the success message named a version that never moved. The rule
 * is per PART — an adapter and the CLI under it move independently — so these
 * cases pin exactly which argv come back for each combination:
 *
 *  - both behind → the adapter install, then the CLI's own updater;
 *  - only the CLI behind → the CLI's updater alone;
 *  - only the adapter behind → the npm install alone;
 *  - neither → nothing at all.
 */

import { describe, expect, test } from 'bun:test';
import { planHarnessUpdate, type UpdatePlanState } from '@/shared/lib/harness/update-plan';
import { harnessUpdateFacts } from '@/shared/lib/harness/updates';

const CLAUDE = harnessUpdateFacts('claude');

function state(overrides: Partial<UpdatePlanState> = {}): UpdatePlanState {
  return {
    installed: true,
    agent: { version: '0.100.0', latest: '0.101.0' },
    cli: { name: 'Claude Code', version: '2.1.318', latest: '2.1.400' },
    ...overrides,
  };
}

describe('planning a harness update', () => {
  test('both parts behind runs the install AND the CLI updater, in that order', () => {
    const steps = planHarnessUpdate('claude', CLAUDE, state(), '0.100.0');
    expect(steps.map((step) => step.argv[0])).toEqual(['npm', 'claude']);
    expect(steps[0].argv).toEqual(['npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.101.0']);
    expect(steps[0].part).toBe('adapter');
    expect(steps[1].argv).toEqual(['claude', 'update']);
    expect(steps[1].part).toBe('Claude Code');
  });

  test('ONLY the CLI behind installs no adapter at all', () => {
    // The half that was missing: the adapter is current, so nothing on npm runs —
    // but the CLI underneath is still stale and must move.
    const steps = planHarnessUpdate(
      'claude',
      CLAUDE,
      state({ agent: { version: '0.101.0', latest: '0.101.0' } }),
      '0.101.0',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].argv).toEqual(['claude', 'update']);
  });

  test('ONLY the adapter behind does not run the CLI updater', () => {
    const steps = planHarnessUpdate(
      'claude',
      CLAUDE,
      state({ cli: { name: 'Claude Code', version: '2.1.400', latest: '2.1.400' } }),
      '0.100.0',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].argv).toEqual(['npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.101.0']);
  });

  test('nothing behind plans nothing, so the route can say "already up to date"', () => {
    const steps = planHarnessUpdate(
      'claude',
      CLAUDE,
      state({ agent: { version: '0.101.0', latest: '0.101.0' }, cli: { name: 'Claude Code', version: '2.1.400', latest: '2.1.400' } }),
      '0.101.0',
    );
    expect(steps).toEqual([]);
  });

  test('a part whose latest version is UNKNOWN is never planned', () => {
    // Kabmo cannot read a registry number for it, so it cannot claim it is behind.
    const steps = planHarnessUpdate(
      'claude',
      CLAUDE,
      state({ cli: { name: 'Claude Code', version: '2.1.318', latest: null } }),
      '0.101.0',
    );
    expect(steps).toEqual([]);
  });

  test('a harness that is not installed plans nothing', () => {
    expect(planHarnessUpdate('claude', CLAUDE, state({ installed: false }), '0.100.0')).toEqual([]);
  });

  test('an unprobed adapter is planned, because a press means "make it current"', () => {
    // With no probe there is no number to compare; answering "already up to date"
    // would be a fabricated fact, so the install runs and the route says so.
    const steps = planHarnessUpdate('claude', CLAUDE, state(), null);
    expect(steps[0].argv[0]).toBe('npm');
  });

  test('a plain npm harness names itself, not "adapter"', () => {
    const steps = planHarnessUpdate(
      'qwen',
      harnessUpdateFacts('qwen'),
      { installed: true, agent: { version: '0.9.0', latest: '0.10.0' }, cli: null },
      '0.9.0',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].part).toBe('qwen');
    expect(steps[0].argv).toEqual(['npm', 'install', '-g', '@qwen-code/qwen-code@0.10.0']);
  });
});
