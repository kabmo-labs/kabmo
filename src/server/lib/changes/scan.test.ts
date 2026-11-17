/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scan's nested-repo pass.
 *
 * A workspace can be a parent repo whose projects are their own checkouts. The
 * parent's `git status` does not show a nested repo's files, so a scan that only
 * asks the parent misses every change an opaque command made inside a project.
 * The nested pass asks each repo directly and records its root, so a clean
 * file's `before` is read from the repo that owns it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { takeScan } from '@/server/lib/changes/scan.server';

let root = '';
let parent = '';
let nested = '';

beforeAll(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-nested-scan-'));
  parent = path.join(root, 'workspace');
  nested = path.join(parent, 'projects', 'p1');
  await fsp.mkdir(nested, { recursive: true });
  await Bun.spawn(['git', '-C', parent, 'init'], { stdout: 'ignore', stderr: 'ignore' }).exited;
  await Bun.spawn(['git', '-C', nested, 'init'], { stdout: 'ignore', stderr: 'ignore' }).exited;
  await fsp.writeFile(path.join(nested, 'a.txt'), 'x');
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('takeScan', () => {
  test('a nested repo is scanned and its root is recorded', async () => {
    const scan = await takeScan(parent);
    // The git root is a realpath; the caller's cwd may be a symlinked spelling.
    const realNested = await fsp.realpath(nested);
    expect(scan?.dirty.has(path.join(realNested, 'a.txt'))).toBe(true);
    expect(scan?.roots?.has(realNested)).toBe(true);
  });
});
