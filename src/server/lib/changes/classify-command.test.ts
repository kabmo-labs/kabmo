/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `bash` classifier: the table that decides what a command will touch.
 *
 * The cases are the ones the journal depends on — `rm`, `mv`, `sed -i`, a
 * redirect, a `git` path restore — plus the two failure modes that must be
 * loud: a glob (the shell expands it, so the path is unknown) and an opaque
 * command (a build, a script), which must be marked rather than guessed.
 *
 * Expected paths are built with `at()`/`abs()`, so the suite asserts the same
 * behaviour on a POSIX host and on Windows.
 */

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import {
  classifyArgv,
  classifyCommand,
  type CommandPlan,
} from '@/server/lib/changes/classify-command';
import { tokenizeCommand } from '@/server/lib/changes/classify-tokenize';

const CWD = path.resolve('/repo');
const HOME = path.resolve('/home/u');

/** A path inside the fixture cwd, spelled the way the host spells it. */
function at(relative: string): string {
  return path.join(CWD, relative);
}

/** An absolute path as the classifier normalizes it. */
function abs(absolute: string): string {
  return path.normalize(absolute);
}

function plan(script: string): CommandPlan {
  return classifyCommand(script, CWD, HOME);
}

function ops(result: CommandPlan): string[] {
  return result.mutations.map((mutation) => `${mutation.op}:${mutation.path}`);
}

describe('classifyCommand', () => {
  test('rm deletes every operand, flags excluded', () => {
    expect(ops(plan('rm -rf src/a.ts'))).toEqual([`delete:${at('src/a.ts')}`]);
    expect(ops(plan('rm -f /tmp/x'))).toEqual([`delete:${abs('/tmp/x')}`]);
    expect(ops(plan('rm a b'))).toEqual([`delete:${at('a')}`, `delete:${at('b')}`]);
  });

  test('mv is a rename with its source', () => {
    const result = plan('mv a b');
    expect(result.mutations).toEqual([{ op: 'rename', path: at('b'), from: at('a') }]);
  });

  test('sed -i updates its file operands; sed without -i is read-only', () => {
    expect(ops(plan("sed -i 's/a/b/' f"))).toEqual([`update:${at('f')}`]);
    expect(ops(plan("sed -i 's/a/b/' f1 f2"))).toEqual([`update:${at('f1')}`, `update:${at('f2')}`]);
    const readOnly = plan("sed 's/a/b/' f");
    expect(readOnly.mutations).toEqual([]);
    expect(readOnly.readOnly).toBe(true);
  });

  test('perl -i and awk -i inplace update their files', () => {
    expect(ops(plan("perl -i -pe 's/a/b/' f"))).toEqual([`update:${at('f')}`]);
    expect(ops(plan("awk -i inplace '{print}' f"))).toEqual([`update:${at('f')}`]);
  });

  test('output redirects are mutations the trace does not model', () => {
    expect(ops(plan('echo hi > out.txt'))).toEqual([`update:${at('out.txt')}`]);
    expect(ops(plan('echo hi >> out.txt'))).toEqual([`update:${at('out.txt')}`]);
    expect(ops(plan('ls 2> err.log'))).toEqual([`update:${at('err.log')}`]);
    expect(ops(plan('ls 2>&1'))).toEqual([]);
    expect(plan('ls 2>&1').readOnly).toBe(true);
  });

  test('cp, tee, truncate, dd, sort -o and curl -o name their destination', () => {
    expect(ops(plan('cp a b'))).toEqual([`update:${at('b')}`]);
    expect(ops(plan('tee out'))).toEqual([`update:${at('out')}`]);
    expect(ops(plan('truncate -s 0 f'))).toEqual([`update:${at('f')}`]);
    expect(ops(plan('dd if=a of=b'))).toEqual([`update:${at('b')}`]);
    expect(ops(plan('sort -o f in'))).toEqual([`update:${at('f')}`]);
    expect(ops(plan('curl -o f https://x'))).toEqual([`update:${at('f')}`]);
  });

  test('git path restores are updates; a hard reset is opaque', () => {
    expect(ops(plan('git checkout -- a b'))).toEqual([`update:${at('a')}`, `update:${at('b')}`]);
    expect(ops(plan('git restore a'))).toEqual([`update:${at('a')}`]);
    expect(ops(plan('git mv a b'))).toEqual([`rename:${at('b')}`]);
    expect(ops(plan('git rm a'))).toEqual([`delete:${at('a')}`]);
    expect(plan('git reset --hard').opaque).toBe(true);
    expect(plan('git clean -fd').opaque).toBe(true);
  });

  test('a glob is opaque: the shell expands it, so the path is unknown', () => {
    const result = plan('rm *.ts');
    expect(result.mutations).toEqual([]);
    expect(result.opaque).toBe(true);
  });

  test('a build or a script is opaque, not read-only', () => {
    expect(plan('bun test').opaque).toBe(true);
    expect(plan('bun test').readOnly).toBe(false);
    expect(plan('node script.js').opaque).toBe(true);
    expect(plan('xargs rm').opaque).toBe(true);
    expect(plan('find . -delete').opaque).toBe(true);
    expect(plan('find . -name x').readOnly).toBe(true);
  });

  test('a read-only command is read-only', () => {
    expect(plan('rg -n foo src').readOnly).toBe(true);
    expect(plan('ls -la').readOnly).toBe(true);
    expect(plan('git status').readOnly).toBe(true);
  });

  test('a cd changes what the later relative paths mean', () => {
    expect(ops(plan('cd sub && rm a'))).toEqual([`delete:${at('sub/a')}`]);
    expect(ops(plan('cd sub && cat > b'))).toEqual([`update:${at('sub/b')}`]);
    expect(plan('cd -').opaque).toBe(true);
  });

  test('an unexpanded variable is opaque, not a literal path', () => {
    const result = plan('cat > $DIR/out.md');
    expect(result.mutations).toEqual([]);
    expect(result.opaque).toBe(true);
  });

  test('a device file is not a working-tree mutation', () => {
    expect(ops(plan('ls 2>/dev/null'))).toEqual([]);
    expect(plan('ls 2>/dev/null').readOnly).toBe(true);
    expect(plan('ls 2>/dev/null').opaque).toBe(false);
  });

  test('a heredoc body is data, not commands', () => {
    const result = plan("cat > f <<'EOF'\nrm x\n> y\nEOF");
    expect(ops(result)).toEqual([`update:${at('f')}`]);
  });

  test('a chain is the union of its commands', () => {
    const result = plan('rm a && echo hi > b');
    expect(ops(result)).toEqual([`delete:${at('a')}`, `update:${at('b')}`]);
    expect(result.readOnly).toBe(false);
  });
});

describe('classifyArgv', () => {
  test('classifies one trace node', () => {
    expect(ops(classifyArgv(['rm', '-rf', 'a'], CWD, HOME))).toEqual([`delete:${at('a')}`]);
    expect(ops(classifyArgv(['sed', '-i', 's/a/b/', 'f'], CWD, HOME))).toEqual([`update:${at('f')}`]);
  });
});

describe('tokenizeCommand', () => {
  test('keeps quoted words whole and separates operators', () => {
    const tokens = tokenizeCommand('a "b c" > d');
    expect(tokens).toEqual([
      { kind: 'word', value: 'a' },
      { kind: 'word', value: 'b c' },
      { kind: 'op', value: '>' },
      { kind: 'word', value: 'd' },
    ]);
  });

  test('does not treat 2>&1 as a file target', () => {
    const tokens = tokenizeCommand('ls 2>&1');
    expect(tokens.some((token) => token.kind === 'op' && token.value === 'fddup')).toBe(true);
  });
});
