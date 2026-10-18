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
 * `OMPCHAMBER_UI_PASSWORD` therefore handed it to every child it spawned —
 * including `runShell`, which runs a third-party plugin's own `bun install`.
 */

import { describe, expect, test } from 'bun:test';

import { childEnv } from '@/server/lib/fs/child-env';
import { UI_PASSWORD_ENV } from '@/shared/lib/auth/password';

describe('childEnv', () => {
  test('withholds the credential and keeps everything else', () => {
    const env = childEnv();
    expect(env[UI_PASSWORD_ENV]).toBeUndefined();
    // The child still needs a PATH, or nothing it runs can be found.
    expect(typeof env.PATH).toBe('string');
  });

  test('caller overrides are applied, but cannot re-introduce the credential', () => {
    // A caller that genuinely needs a variable set still gets it…
    expect(childEnv({ MY_VAR: 'x' }).MY_VAR).toBe('x');
    // …but the withheld name is removed AFTER the merge, so passing it cannot
    // smuggle it through.
    expect(childEnv({ [UI_PASSWORD_ENV]: 'leaked' })[UI_PASSWORD_ENV]).toBeUndefined();
  });

  test('the caller environment is not mutated', () => {
    Bun.env.OMPCHAMBER_CHILD_ENV_PROBE = 'keep';
    childEnv();
    expect(Bun.env.OMPCHAMBER_CHILD_ENV_PROBE).toBe('keep');
    delete Bun.env.OMPCHAMBER_CHILD_ENV_PROBE;
  });
});
