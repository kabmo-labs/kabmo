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
import {
  planHarnessUpdate,
  repointAdapterLaunch,
  type HarnessUpdateStep,
  type UpdatePlanState,
} from '@/shared/lib/harness/update-plan';
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

describe('repointing a launch line after an adapter install', () => {
  const install: HarnessUpdateStep = {
    part: 'adapter',
    command: 'npm install -g @agentclientprotocol/claude-agent-acp@0.101.0 --allow-scripts=@agentclientprotocol/claude-agent-acp',
    argv: [
      'npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.101.0',
      '--allow-scripts=@agentclientprotocol/claude-agent-acp',
    ],
  };

  test('a pinned npx adapter is pointed at the binary the install wrote', () => {
    // The launch requests 0.100.0; the install wrote 0.101.0. Without this, the
    // press reports success and every new session still starts the pinned build.
    expect(repointAdapterLaunch(CLAUDE, [install], '', true)).toBe('claude-agent-acp');
  });

  test('a user command is never replaced', () => {
    expect(repointAdapterLaunch(CLAUDE, [install], '/opt/bin/my-claude-wrapper', true)).toBeNull();
  });

  test('no install step, no repoint', () => {
    expect(repointAdapterLaunch(CLAUDE, [], '', true)).toBeNull();
  });

  test('a binary that did not land on PATH is not claimed', () => {
    expect(repointAdapterLaunch(CLAUDE, [install], '', false)).toBeNull();
  });
});

describe('planning a harness update', () => {
  test('both parts behind runs the install AND the CLI updater, in that order', () => {
    const steps = planHarnessUpdate('claude', CLAUDE, state(), '0.100.0');
    expect(steps.map((step) => step.argv[0])).toEqual(['npm', 'claude']);
    // The per-package `--allow-scripts` is part of the plan: npm 11 skips
    // postinstall by default, and a native CLI installed without it is broken on
    // disk (measured: `bin/claude.exe` left as a "native binary not installed" stub).
    expect(steps[0].argv).toEqual([
      'npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.101.0',
      '--allow-scripts=@agentclientprotocol/claude-agent-acp',
    ]);
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
    // The per-package `--allow-scripts` is part of the plan: npm 11 skips
    // postinstall by default, and a native CLI installed without it is broken on
    // disk (measured: `bin/claude.exe` left as a "native binary not installed" stub).
    expect(steps[0].argv).toEqual([
      'npm', 'install', '-g', '@agentclientprotocol/claude-agent-acp@0.101.0',
      '--allow-scripts=@agentclientprotocol/claude-agent-acp',
    ]);
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

  test('an npm CLI with no vendor updater moves through its own package', () => {
    // `dsh` reports the ACP surface (0.0.1) while `dsh --version` is 0.2.2-rc.1;
    // the CLI carries the package and has no `dsh update`. Leaving this half out
    // made every press compare the adapter's version to the CLI's package.
    const steps = planHarnessUpdate(
      'deepseek-harness',
      harnessUpdateFacts('dsh'),
      {
        installed: true,
        agent: { version: '0.0.1', latest: null },
        cli: { name: 'deepseek-harness', version: '0.2.2-rc.1', latest: '0.3.0' },
      },
      '0.0.1',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].part).toBe('deepseek-harness');
    expect(steps[0].argv).toEqual(['npm', 'install', '-g', '@deepseek-ai/dsh@0.3.0', '--allow-scripts=@deepseek-ai/dsh']);
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
    expect(steps[0].argv).toEqual(['npm', 'install', '-g', '@qwen-code/qwen-code@0.10.0', '--allow-scripts=@qwen-code/qwen-code']);
  });
});
