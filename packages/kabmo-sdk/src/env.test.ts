/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two halves of "what environment does a child of the host get": the
 * variables that must NOT reach it, and the PATH entries it must HAVE.
 *
 * The second half is the one with a measured failure behind it — a server
 * started by launchd (`/usr/bin:/bin:/usr/sbin:/sbin`) could not run `bun`,
 * while the same command in the user's terminal could.
 */

import { describe, expect, test } from 'bun:test';

import {
  KABMO_TOOLCHAIN_PATH_DIRS,
  stripKabmoHostEnv,
  toolchainPathDirs,
  withToolchainPath,
} from './env';

describe('stripKabmoHostEnv', () => {
  test('removes the host variables and keeps the rest', () => {
    const env = stripKabmoHostEnv(
      { PATH: '/usr/bin', PORT: '3001', HOST: '0.0.0.0', NODE_ENV: 'production', KEEP: 'yes' },
      'linux',
    );
    expect(env).toEqual({ PATH: '/usr/bin', KEEP: 'yes' });
  });

  test('removes the NEXT_ namespace wholesale, on a case-insensitive platform', () => {
    expect(stripKabmoHostEnv({ NEXT_PUBLIC_X: '1', next_private: '2', KEEP: '3' }, 'win32')).toEqual({
      KEEP: '3',
    });
  });
});

describe('toolchainPathDirs', () => {
  test('puts the home install directories first, from the env own HOME', () => {
    const dirs = toolchainPathDirs({ HOME: '/home/raj' }, 'linux');
    expect(dirs[0]).toBe('/home/raj/.bun/bin');
    expect(dirs).toContain('/opt/homebrew/bin');
    // The whole list, so a directory dropped from the constant is caught here.
    expect(dirs.slice(-KABMO_TOOLCHAIN_PATH_DIRS.length)).toEqual([...KABMO_TOOLCHAIN_PATH_DIRS]);
  });

  test('has no home entries when the env carries no HOME', () => {
    expect(toolchainPathDirs({}, 'linux')).toEqual([...KABMO_TOOLCHAIN_PATH_DIRS]);
  });

  test('Windows needs no repair: a GUI launch inherits the user environment', () => {
    expect(toolchainPathDirs({ HOME: 'C:\\Users\\raj' }, 'win32')).toEqual([]);
  });
});

describe('withToolchainPath', () => {
  test('appends the missing directories AFTER the inherited ones', () => {
    const env = withToolchainPath({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/home/raj' }, 'linux');
    const entries = (env.PATH ?? '').split(':');
    // The inherited order wins: a version manager's shim must stay first.
    expect(entries[0]).toBe('/opt/homebrew/bin');
    expect(entries[1]).toBe('/usr/bin');
    expect(entries).toContain('/home/raj/.bun/bin');
    expect(entries).toContain('/usr/local/bin');
  });

  test('does not repeat a directory that is already on PATH', () => {
    const env = withToolchainPath({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/home/raj' }, 'linux');
    const entries = (env.PATH ?? '').split(':');
    expect(entries.filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1);
    expect(entries.filter((entry) => entry === '/usr/bin')).toHaveLength(1);
  });

  test('a missing PATH becomes exactly the repair, never an empty search path', () => {
    const env = withToolchainPath({ HOME: '/home/raj' }, 'linux');
    expect(env.PATH).toBe(
      ['/home/raj/.bun/bin', '/home/raj/.local/bin', '/home/raj/.cargo/bin', ...KABMO_TOOLCHAIN_PATH_DIRS].join(':'),
    );
  });

  test('leaves the caller environment untouched', () => {
    const original = { PATH: '/usr/bin', HOME: '/home/raj' };
    withToolchainPath(original, 'linux');
    expect(original).toEqual({ PATH: '/usr/bin', HOME: '/home/raj' });
  });

  test('is a no-op on Windows, where PATH is semicolon-separated', () => {
    expect(withToolchainPath({ PATH: 'C:\\Windows\\system32' }, 'win32')).toEqual({
      PATH: 'C:\\Windows\\system32',
    });
  });
});
