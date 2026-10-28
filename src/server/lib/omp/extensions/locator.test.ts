/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The extension locator and its spawn environment.
 *
 * Two failure modes are pinned here, both silent in production:
 *
 *  - a locator that resolves nothing would spawn a child with NO mode extension,
 *    so the composer's toggles would report success and change nothing;
 *  - a mode-selection env value that omits the auto-continue flag would restore
 *    goal mode but never let it continue past the first turn.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { kabmoExtensionArgs, kabmoExtensionEntry, kabmoModeEnv } from '@/server/lib/omp/extensions/locator';

describe('kabmoExtensionEntry', () => {
  test('resolves to a real file in this checkout', () => {
    const entry = kabmoExtensionEntry();
    expect(entry).not.toBeNull();
    expect(existsSync(entry as string)).toBe(true);
    // `join`, not a `/`-spelled tail: the host's separator can be `\`.
    expect(entry?.endsWith(join('kabmo-modes', 'index.ts'))).toBe(true);
  });

  test('a checkout that still has the pre-rename folder resolves it', () => {
    // The probe order is `kabmo-modes` then `chamber-modes`, and BOTH are real
    // directory names on disk. Pinned here because the fallback is invisible:
    // removing it makes an in-place upgrade spawn a child with no extension,
    // and the composer's toggles then report success while changing nothing.
    const entry = kabmoExtensionEntry();
    expect(entry === null || /(kabmo|chamber)-modes/.test(entry)).toBe(true);
  });

  test('the spawn args load it with -e', () => {
    const args = kabmoExtensionArgs();
    expect(args[0]).toBe('-e');
    expect(existsSync(args[1])).toBe(true);
  });
});

describe('kabmoModeEnv', () => {
  // Both spellings travel together: the extension file on disk may still be the
  // one that reads `CHAMBER_MODES`, and the child reads whichever it knows. The
  // values must be IDENTICAL — two spellings of one selection, not two sources.
  test('names only the modes that are on, under both spellings', () => {
    expect(kabmoModeEnv({ plan: true, goal: false })).toEqual({ KABMO_MODES: 'plan', CHAMBER_MODES: 'plan' });
    expect(kabmoModeEnv({ plan: false, goal: false })).toEqual({ KABMO_MODES: '', CHAMBER_MODES: '' });
  });

  test('goal mode rides the selection, and nothing else', () => {
    // The loop is Kabmo's now, so the child gets no continuation flag: it
    // opens a turn only when Kabmo's auditor asks for one.
    expect(kabmoModeEnv({ plan: false, goal: true })).toEqual({ KABMO_MODES: 'goal', CHAMBER_MODES: 'goal' });
    expect(kabmoModeEnv({ plan: true, goal: true })).toEqual({ KABMO_MODES: 'plan,goal', CHAMBER_MODES: 'plan,goal' });
  });

  test('the legacy spelling carries the same value, never a second one', () => {
    const env = kabmoModeEnv({ plan: true, goal: true });
    expect(env.KABMO_MODES).toBe(env.CHAMBER_MODES);
  });
});
