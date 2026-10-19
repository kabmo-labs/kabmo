/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The TUI-only guard vs the commands Kabmo now owns.
 *
 * `/plan` and `/goal` are `handleTui`-only in omp, so the guard would refuse a
 * prompt carrying one — but Kabmo drives both modes through its own
 * extension inside the child, so a typed `/plan` is a real command now. The two
 * lists have to agree: a name that moved into `KABMO_COMMANDS` without
 * leaving `TUI_ONLY_SLASH_COMMANDS` would be refused by the very guard that
 * exists to protect it, and the composer would offer a command that never runs.
 */

import { describe, expect, test } from 'bun:test';
import {
  KABMO_OWNED_SLASH_COMMANDS,
  TUI_ONLY_SLASH_COMMANDS,
  isTuiOnlySlashCommand,
} from '@/shared/lib/chat/composer/tui-only';
import { KABMO_COMMANDS } from '@/shared/lib/chat/composer/trigger';

describe('chamber-owned slash commands', () => {
  test('every Kabmo command is exempt from the TUI-only refusal', () => {
    for (const command of KABMO_COMMANDS) {
      expect(isTuiOnlySlashCommand(`/${command.name}`)).toBe(false);
    }
  });

  test('the exemption set is derived from the command list, not restated', () => {
    for (const command of KABMO_COMMANDS) {
      expect(KABMO_OWNED_SLASH_COMMANDS[command.name.toLowerCase()]).toBe(true);
    }
    expect(Object.keys(KABMO_OWNED_SLASH_COMMANDS).sort()).toEqual(
      KABMO_COMMANDS.map((c) => c.name.toLowerCase()).sort(),
    );
  });

  test('plan and goal are no longer in the refusal table', () => {
    // Leaving them there is the failure this pins: the guard would refuse a
    // command the extension answers.
    expect(TUI_ONLY_SLASH_COMMANDS.plan).toBeUndefined();
    expect(TUI_ONLY_SLASH_COMMANDS.goal).toBeUndefined();
  });

  test('the commands with no extension counterpart stay refused', () => {
    expect(isTuiOnlySlashCommand('/plan-review')).toBe(true);
    expect(isTuiOnlySlashCommand('/guided-goal make auth safer')).toBe(true);
    expect(isTuiOnlySlashCommand('/clear')).toBe(true);
  });
});
