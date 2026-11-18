/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paths a tool call can touch, read from its args before it runs.
 *
 * Every case is a spelling a real agent sends: omp's `path`, ACP's `filePath`,
 * Claude's `file_path`, an `apply_patch` that names them only in the patch text,
 * and a `bash` call whose plan carries the mutations (plus the source side of a
 * move, which is what makes a `mv` snapshot the file that disappears).
 */

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { captureTargets } from '@/server/lib/changes/capture-targets';
import type { PendingCall } from '@/server/lib/changes/capture-types';

const CWD = path.resolve('/work');

function pending(tool: string, args: Record<string, unknown>): PendingCall {
  return {
    toolCallId: 'c1',
    tool,
    agent: 'Main',
    startedAt: 0,
    args,
    before: new Map(),
    ready: Promise.resolve(),
  };
}

describe('captureTargets', () => {
  test('a file tool resolves its relative path against the session cwd', () => {
    expect(captureTargets(pending('edit', { path: 'src/a.ts' }), CWD)).toEqual([path.join(CWD, 'src/a.ts')]);
  });

  test('every arg spelling an agent uses is a target', () => {
    const args = { path: 'a.ts', file_path: 'b.ts', filePath: 'c.ts', moveTo: 'd.ts', destination: 'e.ts' };
    expect(captureTargets(pending('edit', args), CWD)).toEqual(['a', 'b', 'c', 'd', 'e'].map((name) => path.join(CWD, `${name}.ts`)));
  });

  test('an absolute path is normalized, not re-rooted', () => {
    const absolute = path.resolve('/other/x.ts');
    expect(captureTargets(pending('write', { path: absolute }), CWD)).toEqual([absolute]);
  });

  test('an apply_patch names its paths inside the patch text', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/one.ts',
      '*** Move to: src/two.ts',
      '*** Add File: src/three.ts',
      '*** End Patch',
    ].join('\n');
    expect(captureTargets(pending('apply_patch', { patch }), CWD)).toEqual(
      ['src/one.ts', 'src/two.ts', 'src/three.ts'].map((relative) => path.join(CWD, relative)),
    );
  });

  test('a bash call takes its plan mutations, including the side a move leaves', () => {
    const plan = {
      scan: false,
      opaque: false,
      readOnly: false,
      mutations: [
        { path: path.join(CWD, 'from.ts'), from: path.join(CWD, 'old.ts'), op: 'update' as const },
        { path: path.join(CWD, 'new.ts'), op: 'create' as const },
      ],
    };
    const call = { ...pending('bash', { command: 'mv old.ts from.ts' }), plan };
    expect(captureTargets(call, CWD)).toEqual([path.join(CWD, 'from.ts'), path.join(CWD, 'old.ts'), path.join(CWD, 'new.ts')]);
  });

  test('a URL is not a path', () => {
    expect(captureTargets(pending('read', { path: 'https://example.test/a.ts' }), CWD)).toEqual([]);
  });

  test('a tool with no path arg has no target', () => {
    expect(captureTargets(pending('read', {}), CWD)).toEqual([]);
  });
});
