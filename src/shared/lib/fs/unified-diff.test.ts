/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The unified patch the journal diff tab copies. The panel renders the two
 * sides itself, so this is the one place a wrong hunk header or a lost context
 * line would reach the clipboard unnoticed.
 */

import { describe, expect, test } from 'bun:test';
import { unifiedDiff } from '@/shared/lib/fs/unified-diff';

describe('unifiedDiff', () => {
  test('equal texts produce no patch', () => {
    expect(unifiedDiff('a.ts', 'one\ntwo\n', 'one\ntwo\n')).toBe('');
  });

  test('a changed line keeps three lines of context and a correct header', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\n';
    const after = 'a\nb\nc\nD\ne\nf\ng\n';
    const patch = unifiedDiff('src/x.ts', before, after);
    expect(patch).toContain('--- a/src/x.ts');
    expect(patch).toContain('+++ b/src/x.ts');
    expect(patch).toContain('@@ -1,7 +1,7 @@');
    expect(patch).toContain('-d');
    expect(patch).toContain('+D');
    expect(patch).toContain(' a');
    expect(patch).toContain(' g');
  });

  test('a created file is all additions', () => {
    const patch = unifiedDiff('new.ts', '', 'one\ntwo\n');
    expect(patch).toContain('@@ -0,0 +1,2 @@');
    expect(patch).toContain('+one');
    expect(patch).toContain('+two');
  });

  test('a deleted file is all deletions', () => {
    const patch = unifiedDiff('gone.ts', 'one\ntwo\n', '');
    expect(patch).toContain('@@ -1,2 +0,0 @@');
    expect(patch).toContain('-one');
    expect(patch).toContain('-two');
  });

  test('two distant changes become two hunks', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
    const after = before.replace('line 1\n', 'LINE 1\n').replace('line 38', 'LINE 38');
    const patch = unifiedDiff('big.ts', before, after);
    expect(patch.match(/^@@ /gm)?.length).toBe(2);
  });
});
