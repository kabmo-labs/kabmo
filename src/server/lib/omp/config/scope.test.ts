/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scope a skills/commands read is answered for.
 *
 * The rules worth locking are the fallbacks, because each one silently answers
 * a DIFFERENT inventory rather than failing: a blank root must keep the
 * historical app-root meaning (the composer's request for a session with no
 * workspace folder), `scope=user` must win over a root a stale client still
 * sends, and an unreadable root must fall back to the user scope rather than a
 * directory the caller never asked about.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { resolveDiscoveryScope } from '@/server/lib/omp/config/scope';
import { getAgentDir } from '@/server/lib/omp/core/paths';

const APP_ROOT = process.cwd();

describe('resolveDiscoveryScope', () => {
  test('scope=user reads the agent dir with no writable workspace', async () => {
    expect(await resolveDiscoveryScope(null, 'user')).toEqual({ workspace: null, cwd: getAgentDir() });
  });

  test('scope=user wins over a root, so a stale client cannot resurrect one', async () => {
    expect(await resolveDiscoveryScope(APP_ROOT, 'user')).toEqual({ workspace: null, cwd: getAgentDir() });
  });

  test('no root keeps the app root as an unscoped workspace', async () => {
    expect(await resolveDiscoveryScope(null)).toEqual({ workspace: APP_ROOT, cwd: APP_ROOT });
    expect(await resolveDiscoveryScope('  ')).toEqual({ workspace: APP_ROOT, cwd: APP_ROOT });
  });

  test('a real directory under the app root is the workspace it names', async () => {
    // `join`, not a `${APP_ROOT}/src` literal: a `/`-spelled child cannot be
    // inside a `\`-spelled root on Windows, so the resolver falls back to the
    // user scope and the case fails for a reason the code under test lacks.
    const sub = join(APP_ROOT, 'src');
    expect(await resolveDiscoveryScope(sub)).toEqual({ workspace: sub, cwd: sub });
  });

  test('an unreadable root falls back to the user scope', async () => {
    expect(await resolveDiscoveryScope(`${APP_ROOT}/__no_such_dir__`)).toEqual({
      workspace: null,
      cwd: getAgentDir(),
    });
  });
});
