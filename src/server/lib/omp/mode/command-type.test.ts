/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mode command's wire type, under both spellings.
 *
 * `kabmo_mode` is what this build's client posts and `chamber_mode` is the
 * pre-rename spelling. The route has to accept BOTH: a tab that loaded before a
 * server restart keeps posting the old token until it reloads, and a rejected
 * request there reads as a dead Plan/Goal button — the toggle reports nothing
 * and the mode never moves.
 */

import { describe, expect, test } from 'bun:test';
import {
  LEGACY_MODE_COMMAND_TYPE,
  MODE_COMMAND_TYPE,
  isModeCommandType,
  modeCommandPrompt,
} from '@/server/lib/omp/mode/request';

describe('mode command type', () => {
  test('the current spelling is what this build sends', () => {
    expect(MODE_COMMAND_TYPE).toBe('kabmo_mode');
  });

  test('both spellings are accepted, and nothing else is', () => {
    expect(isModeCommandType(MODE_COMMAND_TYPE)).toBe(true);
    expect(isModeCommandType(LEGACY_MODE_COMMAND_TYPE)).toBe(true);
    expect(isModeCommandType('prompt')).toBe(false);
    expect(isModeCommandType(undefined)).toBe(false);
  });

  test('the prompt carries the current command name, whichever type arrived', () => {
    // The wire type and the slash command are separate names: the type decides
    // which branch the route takes, the command decides what the child runs.
    expect(modeCommandPrompt({ scope: 'plan', action: 'on' })).toBe('/kabmo-mode plan on');
  });
});
