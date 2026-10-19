/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one place that decides what a child process inherits.
 *
 * The failure this prevents is silent and total: `Bun.spawn` with no `env`
 * inherits the OS environ, and `delete Bun.env.X` does not remove a value that
 * was there at startup (measured on Bun 1.4.3). A server that received
 * `KABMO_UI_PASSWORD` therefore handed it to every child it spawned —
 * including `runShell`, which runs a third-party plugin's own `bun install`.
 */

import { describe, expect, test } from 'bun:test';

import { childEnv } from '@/server/lib/fs/child-env';
import { UI_PASSWORD_ENV } from '@/shared/lib/auth/password';

describe('childEnv', () => {
  /**
   * The PATH entry as the running platform spells it.
   *
   * Windows env names are case-insensitive and the OS normally spells it
   * `Path`, so `env.PATH` is undefined there — measured on the Windows leg,
   * where the assertion below failed on a `childEnv()` that was correct. The
   * variable is still present; only the casing differs.
   */
  function pathEntry(env: Record<string, string | undefined>): string | undefined {
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
    return key === undefined ? undefined : env[key];
  }

  test('withholds the credential and keeps everything else', () => {
    const env = childEnv();
    expect(env[UI_PASSWORD_ENV]).toBeUndefined();
    // The child still needs a PATH, or nothing it runs can be found.
    expect(typeof pathEntry(env)).toBe('string');
  });

  test('caller overrides are applied, but cannot re-introduce the credential', () => {
    // A caller that genuinely needs a variable set still gets it…
    expect(childEnv({ MY_VAR: 'x' }).MY_VAR).toBe('x');
    // …but the withheld name is removed AFTER the merge, so passing it cannot
    // smuggle it through.
    expect(childEnv({ [UI_PASSWORD_ENV]: 'leaked' })[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('the caller environment is not mutated', () => {
    Bun.env.KABMO_CHILD_ENV_PROBE = 'keep';
    childEnv();
    expect(Bun.env.KABMO_CHILD_ENV_PROBE).toBe('keep');
    delete Bun.env.KABMO_CHILD_ENV_PROBE;
  });

  test('a differently-cased spelling of the credential is withheld on Windows', () => {
    // Env names are case-insensitive there, so this IS the withheld variable —
    // an exact-name delete would hand the secret to the child. Injected because
    // a POSIX runner cannot observe the branch otherwise.
    const env = childEnv({ [UI_PASSWORD_ENV.toLowerCase()]: 'leaked' }, 'win32');
    expect(env[UI_PASSWORD_ENV.toLowerCase()]).toBeUndefined();
    // On POSIX the name is a different variable and is left alone.
    expect(childEnv({ [UI_PASSWORD_ENV.toLowerCase()]: 'kept' }, 'linux')[UI_PASSWORD_ENV.toLowerCase()]).toBe('kept');
  });
});
