/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The journal's temp-path exclusion.
 *
 * `/tmp` and the OS temp directory are scratch, not workspace; both the writer
 * and the reader drop them. The check resolves real paths because macOS spells
 * the same temp file as `/tmp/...` and `/private/tmp/...`.
 */

import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { isBuildPath, isExcludedTempPath, isTempPath } from '@/server/lib/changes/temp-path';

describe('isTempPath', () => {
  test('excludes /tmp and the OS temp dir', () => {
    expect(isTempPath('/tmp/a.txt')).toBe(true);
    expect(isTempPath(path.join(os.tmpdir(), 'a.txt'))).toBe(true);
  });

  test('keeps a workspace path', () => {
    expect(isTempPath('/repo/a.txt')).toBe(false);
    expect(isTempPath(path.resolve('src/a.ts'))).toBe(false);
  });

  test('a temp path inside the session cwd is kept', () => {
    expect(isExcludedTempPath('/tmp/ws/a.txt', '/tmp/ws')).toBe(false);
  });

  test('a temp path outside the session cwd is excluded', () => {
    expect(isExcludedTempPath('/tmp/other/a.txt', '/repo')).toBe(true);
  });

  test('a build path under the cwd is excluded', () => {
    expect(isBuildPath('/repo/dist/client/a.js', '/repo')).toBe(true);
    expect(isBuildPath('/repo/packages/foo/dist/a.js', '/repo')).toBe(true);
    expect(isBuildPath('/repo/node_modules/x/a.js', '/repo')).toBe(true);
    expect(isBuildPath('/repo/src/a.ts', '/repo')).toBe(false);
    expect(isBuildPath('/other/dist/a.js', '/repo')).toBe(false);
  });
});
