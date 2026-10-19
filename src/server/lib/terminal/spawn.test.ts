/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one spawn option that differs by platform, asserted per platform.
 *
 * `detached` is not a portable idea. On POSIX it is `setsid()` and the terminal
 * panel needs it; on Windows it is `DETACHED_PROCESS`, which gives the child NO
 * console — and `cmd.exe` will not run without one, so every shell died with
 * `exitCode: 1` within a second. Measured on the Windows CI runner: all eight
 * attached shells came back `status: "exited"`, which made the terminal panel
 * look broken and left the capacity cap counting nothing.
 *
 * A POSIX-only run cannot observe that, which is why the options are built by a
 * function taking a `platform` argument instead of a literal at the spawn site.
 */

import { describe, expect, test } from 'bun:test';
import { shellSpawnOptions } from '@/server/lib/terminal/spawn';

/** A stand-in for the PTY; the builder only passes it through. */
const TERMINAL = { cols: 80, rows: 24 } as unknown as Bun.Terminal;
const BASE = { terminal: TERMINAL, cwd: '/work', env: { PATH: '/usr/bin' } };

describe('shellSpawnOptions', () => {
  test('POSIX detaches, so a group signal reaches what the shell started', () => {
    // Without it the child sits in the SERVER's process group: `kill(-pid)` is
    // ESRCH, Ctrl+Z stops working, and a group signal would take Kabmo
    // down with the shell.
    for (const platform of ['darwin', 'linux'] as const) {
      expect(shellSpawnOptions({ ...BASE, platform }).detached).toBe(true);
    }
  });

  test('Windows does NOT detach, because DETACHED_PROCESS leaves no console', () => {
    // The bug this pins: with `detached: true` the shell had no console at all
    // and `cmd.exe` exited 1 immediately, so the panel showed a dead terminal
    // and the cap counted zero shells.
    expect(shellSpawnOptions({ ...BASE, platform: 'win32' }).detached).toBe(false);
  });

  test('everything else is passed through unchanged', () => {
    const options = shellSpawnOptions({ ...BASE, platform: 'win32' });
    expect(options.terminal).toBe(TERMINAL);
    expect(options.cwd).toBe('/work');
    expect(options.env).toEqual({ PATH: '/usr/bin' });
  });
});
