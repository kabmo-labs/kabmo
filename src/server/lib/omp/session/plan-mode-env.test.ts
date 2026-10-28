/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Restoring modes on a cold spawn.
 *
 * `--mode rpc-ui` never restores `mode_change`, so a session reopened from the
 * sidebar would come back with both modes off while the composer's toggles —
 * which read the persisted selection — said they were on. The spawn environment
 * is the only channel available before the child's first command, and these are
 * the rules that decide what goes in it.
 */

import { describe, expect, test } from 'bun:test';
import { readPersistedModes } from '@/server/lib/omp/session/modes';
import { kabmoModeEnv } from '@/server/lib/omp/extensions/locator';

const line = (customType: string, data: unknown) => JSON.stringify({ type: 'custom', customType, data });

describe('spawn-time mode restore', () => {
  test('a session left in plan mode spawns with plan in its environment', () => {
    const modes = readPersistedModes(line('chamber-plan-state', { enabled: true }));
    expect(kabmoModeEnv(modes).CHAMBER_MODES).toBe('plan');
  });

  test('a session with a LIVE goal spawns with goal mode on', () => {
    const modes = readPersistedModes(
      line('chamber-goal-state', {
        enabled: true,
        goal: { id: 'g1', objective: 'x', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
      }),
    );
    // The loop itself is not the child's: it drives nothing on its own, and the
    // Kabmo's auditor decides whether the next turn is opened (or whether the
    // goal stops) — so the spawn carries the MODE, nothing more.
    expect(kabmoModeEnv(modes).CHAMBER_MODES).toBe('goal');
  });

  test('a PAUSED goal restores the mode, and a finished one restores nothing', () => {
    // Pause is an instruction: the toggle reads as on (the goal exists) while
    // Kabmo's driver refuses to advance it — the status is what decides,
    // not a spawn flag. Resume is the operator's move.
    const paused = readPersistedModes(
      line('chamber-goal-state', {
        enabled: true,
        goal: { id: 'g1', objective: 'x', status: 'paused', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
      }),
    );
    expect(paused.goal).toBe(true);
    expect(paused.goalLive).toBe(false);
    expect(kabmoModeEnv(paused).CHAMBER_MODES).toBe('goal');
  });

  test('a finished goal does not restore anything', () => {
    const modes = readPersistedModes(
      line('chamber-goal-state', {
        enabled: false,
        goal: { id: 'g1', objective: 'x', status: 'complete', tokensUsed: 1, timeUsedSeconds: 1, createdAt: 0, updatedAt: 0 },
      }),
    );
    expect(kabmoModeEnv(modes).CHAMBER_MODES).toBe('');
  });
});
