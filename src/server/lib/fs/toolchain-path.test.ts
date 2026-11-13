/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The lookup a login-entry launch needs.
 *
 * The bug this pins: launchd starts the server with
 * `/usr/bin:/bin:/usr/sbin:/sbin` (measured — the `dev.kabmo.tray` plist carries
 * no `EnvironmentVariables`), so `Bun.which('npx')` answered null while
 * `/opt/homebrew/bin/npx` was installed. Every `npx`-launched harness read "not
 * installed" on the first boot after login and `ready` after a terminal start.
 *
 * The cases below hand in the environment rather than mutating `Bun.env`, so the
 * suite measures the repair itself and not the runner's PATH.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { toolchainPath, whichOnToolchainPath } from '@/server/lib/fs/toolchain-path';

const home = fs.mkdtempSync(join(os.tmpdir(), 'kabmo-toolchain-'));
const bunBin = join(home, '.bun', 'bin');
fs.mkdirSync(bunBin, { recursive: true });
const fakeTool = join(bunBin, 'kabmo-fake-tool');
fs.writeFileSync(fakeTool, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('toolchainPath', () => {
  test('keeps the inherited order and appends what a GUI launch never had', () => {
    const path = toolchainPath({ PATH: '/usr/bin:/bin', HOME: home }, 'linux');
    const entries = path.split(':');
    expect(entries.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(entries).toContain(join(home, '.bun', 'bin'));
    expect(entries).toContain('/opt/homebrew/bin');
    expect(entries).toContain('/usr/local/bin');
  });

  test('does not append an entry the inherited PATH already names', () => {
    const path = toolchainPath({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: home }, 'linux');
    expect(path.split(':').filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1);
  });

  test('a missing PATH becomes the fallback list, not an empty search path', () => {
    const path = toolchainPath({ HOME: home }, 'linux');
    expect(path.split(':')).toContain(join(home, '.bun', 'bin'));
    expect(path.split(':')).toContain('/usr/bin');
  });

  test('Windows is left alone: a GUI launch there inherits the user environment', () => {
    expect(toolchainPath({ PATH: 'C:\\Windows\\system32' }, 'win32')).toBe('C:\\Windows\\system32');
  });
});

describe('whichOnToolchainPath', () => {
  test.skipIf(process.platform === 'win32')(
    'finds a binary that only exists in a toolchain directory',
    () => {
      // The launchd shape: the inherited PATH cannot see `~/.bun/bin`.
      const env = { PATH: '/usr/bin:/bin', HOME: home };
      expect(Bun.which('kabmo-fake-tool', { PATH: env.PATH })).toBeNull();
      expect(whichOnToolchainPath('kabmo-fake-tool', env, 'linux')).toBe(fakeTool);
    },
  );

  test('a binary nowhere the user shell would look is still null', () => {
    expect(whichOnToolchainPath('kabmo-definitely-missing-xyz', { PATH: '/usr/bin:/bin', HOME: home }, 'linux'))
      .toBeNull();
  });
});
