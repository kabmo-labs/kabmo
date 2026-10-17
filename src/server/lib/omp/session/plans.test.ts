/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plan reader's path handling, which is its security boundary.
 *
 * `readSessionPlans` joins a caller-supplied `?path=` onto a FIXED directory
 * (the session's own artifact root), so the only thing standing between the
 * route and an arbitrary file read is `safePlanName`. These cases are the ones
 * that matter: a traversal, a separator, an absolute path, and a name that is
 * not a plan at all. Every one must be refused BEFORE anything reaches the
 * filesystem.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { localRootForSessionFile, safePlanName } from '@/server/lib/omp/session/plans';

describe('safePlanName', () => {
  test('accepts a bare plan filename, with or without the local:// prefix', () => {
    expect(safePlanName('add-a-panel-plan.md')).toBe('add-a-panel-plan.md');
    expect(safePlanName('local://add-a-panel-plan.md')).toBe('add-a-panel-plan.md');
    // omp's suffix is matched case-insensitively (`listPlanFiles` does the same).
    expect(safePlanName('local://Add-A-Panel-PLAN.MD')).toBe('Add-A-Panel-PLAN.MD');
  });

  test('refuses a traversal, a separator or an absolute path', () => {
    expect(safePlanName('../../../../etc/passwd')).toBeNull();
    expect(safePlanName('..%2f..%2fetc%2fpasswd')).toBeNull();
    expect(safePlanName('sub/plan.md')).toBeNull();
    expect(safePlanName('/etc/passwd')).toBeNull();
    expect(safePlanName('local://../../etc/passwd')).toBeNull();
    // A bare `..` segment, even with the plan suffix on it.
    expect(safePlanName('../plan.md')).toBeNull();
  });

  test('refuses a name that is not a plan artifact', () => {
    // The suffix check is what stops this route reading any other file that
    // happens to sit in the artifacts directory (scratch files, research notes).
    expect(safePlanName('notes.md')).toBeNull();
    expect(safePlanName('session.jsonl')).toBeNull();
    expect(safePlanName('plan.md.bak')).toBeNull();
  });

  test('refuses an absent or empty request', () => {
    expect(safePlanName(null)).toBeNull();
    expect(safePlanName(undefined)).toBeNull();
    expect(safePlanName('')).toBeNull();
    expect(safePlanName('local://')).toBeNull();
  });
});

describe('localRootForSessionFile', () => {
  test('is the session file without its .jsonl, plus local/', () => {
    // omp's own rule (`resolveLocalRoot` = artifactsDir/local, where the
    // artifacts dir is the session file minus the extension) — the chamber must
    // not keep a second spelling of it. Built with `join`, not `/` literals, so
    // the separator is the host's and the round-trip is asserted the same way.
    const file = join('/sessions', 'proj', '2026-01-01T00-00-00-000Z_abc.jsonl');
    expect(localRootForSessionFile(file)).toBe(join('/sessions', 'proj', '2026-01-01T00-00-00-000Z_abc', 'local'));
  });
});
