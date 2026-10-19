/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a run's password comes from, and the environment cleanup that goes with
 * it.
 *
 * Two behaviours are load-bearing and both are silent when broken: the
 * environment variable must be ERASED as it is read (or every child process can
 * see the password), and a missing source must mean "no authentication" rather
 * than a failure (or a plain `bun run dev` would refuse to start).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveRunPassword, UI_PASSWORD_FLAG } from '@/server/lib/auth/env-password';
import { stripChamberHostEnv } from '@kabmo-labs/plugin-sdk';
import { terminalEnv } from '@/server/lib/terminal/shell';
import { UI_PASSWORD_ENV } from '@/shared/lib/auth/password';

const PASSWORD = 'hunter2-do-not-leak';

beforeEach(() => {
  delete Bun.env[UI_PASSWORD_ENV];
});

afterEach(() => {
  delete Bun.env[UI_PASSWORD_ENV];
});

describe('resolveRunPassword', () => {
  test('reads the flag with a separate value', () => {
    expect(resolveRunPassword(['bun', 'index.ts', UI_PASSWORD_FLAG, PASSWORD]))
      .toEqual({ password: PASSWORD, source: 'argv' });
  });

  test('reads the flag with an inline value', () => {
    expect(resolveRunPassword(['bun', 'index.ts', `${UI_PASSWORD_FLAG}=${PASSWORD}`]))
      .toEqual({ password: PASSWORD, source: 'argv' });
  });

  test('a bare flag is not a password', () => {
    // `--ui-password` followed by another flag must not swallow that flag.
    expect(resolveRunPassword(['bun', 'index.ts', UI_PASSWORD_FLAG, '--lan']))
      .toEqual({ password: null, source: 'none' });
    expect(resolveRunPassword(['bun', 'index.ts', UI_PASSWORD_FLAG]))
      .toEqual({ password: null, source: 'none' });
  });

  test('reads the environment variable and ERASES it', () => {
    Bun.env[UI_PASSWORD_ENV] = PASSWORD;
    const resolved = resolveRunPassword(['bun', 'index.ts']);

    expect(resolved).toEqual({ password: PASSWORD, source: 'env' });
    // The whole reason this module owns the read: `Bun.env` is `process.env`, and
    // every child inherits it.
    expect(Bun.env[UI_PASSWORD_ENV]).toBeUndefined();
    expect(process.env[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('erases the variable even when it is blank', () => {
    Bun.env[UI_PASSWORD_ENV] = '   ';
    expect(resolveRunPassword(['bun', 'index.ts'])).toEqual({ password: null, source: 'none' });
    expect(Bun.env[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('the flag beats an inherited variable', () => {
    Bun.env[UI_PASSWORD_ENV] = 'from-env';
    const resolved = resolveRunPassword(['bun', 'index.ts', UI_PASSWORD_FLAG, 'from-flag']);
    expect(resolved).toEqual({ password: 'from-flag', source: 'argv' });
    // The variable is still erased: it was read, just not used.
    expect(Bun.env[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('neither source means no authentication, not an error', () => {
    expect(resolveRunPassword(['bun', 'index.ts'])).toEqual({ password: null, source: 'none' });
  });
});

describe('the password never reaches a child process', () => {
  test('the terminal PTY environment strips it', () => {
    const env = terminalEnv({ PATH: '/usr/bin', [UI_PASSWORD_ENV]: PASSWORD }, 'dark');
    expect(env[UI_PASSWORD_ENV]).toBeUndefined();
    // The rest of the environment is still passed through, or the shell would
    // lose PATH and every command in the panel would fail.
    expect(env.PATH).toBe('/usr/bin');
  });

  test('the omp child environment strips it', () => {
    const env = stripChamberHostEnv({ PATH: '/usr/bin', [UI_PASSWORD_ENV]: PASSWORD }, process.platform);
    expect(env[UI_PASSWORD_ENV]).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  test('the strip is case-insensitive on Windows, where env names are', () => {
    const env = stripChamberHostEnv(
      { PATH: 'C:\\Windows', [UI_PASSWORD_ENV]: PASSWORD },
      'win32',
    );
    expect(env[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('both strips leave a name that merely resembles it alone', () => {
    // `OMPCHAMBER_UI_PASSWORD_FILE` is a different variable; a prefix match that
    // removed it would be a silent misconfiguration.
    const base = { PATH: '/usr/bin', OMPCHAMBER_UI_PASSWORD_FILE: '/tmp/x' };
    expect(terminalEnv(base, 'dark').OMPCHAMBER_UI_PASSWORD_FILE).toBe('/tmp/x');
    expect(stripChamberHostEnv(base, process.platform).OMPCHAMBER_UI_PASSWORD_FILE).toBe('/tmp/x');
  });
});
