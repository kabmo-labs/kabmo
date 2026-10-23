/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';
import { isVirtualPath, lastPathSegment, stripReadSelector } from '@/shared/lib/fs/paths';

describe('stripReadSelector', () => {
  test('peels every selector shape omp accepts', () => {
    // A `read` may name its lines on the path itself, and the whole string was
    // carried around as if it were the file name — the language detector read
    // the extension as `tsx:205-215:raw` and answered `text`, so the code
    // surface rendered unhighlighted. Measured on a real session store: 9517 of
    // 18128 read paths carry a selector, and 1268 of them (`:raw`, `:img`, a
    // comma list) were missed by the previous `:N-M`-only strip.
    expect(stripReadSelector('src/Read.tsx:205-215:raw')).toBe('src/Read.tsx');
    expect(stripReadSelector('src/Read.tsx:raw')).toBe('src/Read.tsx');
    expect(stripReadSelector('src/Read.tsx:205-215')).toBe('src/Read.tsx');
    expect(stripReadSelector('src/a.ts:50')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:50-')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:50+150')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:-60')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:5-16,960-973')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:19,59')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:conflicts')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:img')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:raw:50-100')).toBe('src/a.ts');
    expect(stripReadSelector('a.py:10-20:raw')).toBe('a.py');
  });

  test('a compound selector in either order comes off whole', () => {
    expect(stripReadSelector('src/a.ts:1-50:raw')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:raw:-60')).toBe('src/a.ts');
  });

  test('an incomplete selector is left alone', () => {
    // omp's own splitter only peels a chunk that ENDS in a digit, `.` or `-`,
    // which is what rejects the in-flight `path:50+`.
    expect(stripReadSelector('src/a.ts:50+')).toBe('src/a.ts:50+');
  });

  test('a chunk that is not a selector stays part of the path', () => {
    // The trailing rule is a chunk SHAPE test, not "the path looks like a
    // file": a Windows drive letter and a version-ish suffix both survive,
    // which is the conservatism omp's own splitter applies.
    expect(stripReadSelector('C:\\proj\\x.ts')).toBe('C:\\proj\\x.ts');
    expect(stripReadSelector('src/a.ts')).toBe('src/a.ts');
    expect(stripReadSelector('release/v1.2.3:notes.md')).toBe('release/v1.2.3:notes.md');
  });

  test('a URL is untouched — its colon can be a port', () => {
    // `http://host:8080/x` would otherwise lose `:8080` to the line-range rule.
    expect(stripReadSelector('http://host:8080/x.ts')).toBe('http://host:8080/x.ts');
    expect(stripReadSelector('xd://eval/browser')).toBe('xd://eval/browser');
    expect(stripReadSelector('proc://kabmo-dev')).toBe('proc://kabmo-dev');
    expect(stripReadSelector('skill://diagnose')).toBe('skill://diagnose');
  });

  test('query and hash come off', () => {
    expect(stripReadSelector('src/a.ts?x=1#L4')).toBe('src/a.ts');
    expect(stripReadSelector('src/a.ts:12-30?raw=1')).toBe('src/a.ts');
  });
});

describe('isVirtualPath', () => {
  test('recognizes an omp internal URL', () => {
    expect(isVirtualPath('proc://kabmo-dev')).toBe(true);
    expect(isVirtualPath('xd://lsp')).toBe(true);
    expect(isVirtualPath('agent://Sleeper')).toBe(true);
    expect(isVirtualPath('skill://pr-review')).toBe(true);
    expect(isVirtualPath('artifact://17')).toBe(true);
  });

  test('leaves a real path alone', () => {
    expect(isVirtualPath('src/x.ts')).toBe(false);
    expect(isVirtualPath('/tmp/x.png')).toBe(false);
    expect(isVirtualPath('C:\\proj\\x.ts')).toBe(false);
    expect(isVirtualPath('~/x.ts')).toBe(false);
  });

  test('a bare colon is not a scheme — a Windows drive letter stays a path', () => {
    expect(isVirtualPath('C:/proj/x.ts')).toBe(false);
  });

  test('nothing is not a virtual path', () => {
    expect(isVirtualPath(undefined)).toBe(false);
    expect(isVirtualPath('')).toBe(false);
  });
});

describe('lastPathSegment', () => {
  test('names the last segment on either separator', () => {
    // The Windows case is the one that shipped broken: the composer's target
    // trigger read `kabmo · C:\Users\…\cosmic-dolphin`, because `split('/')`
    // has nothing to cut in a `\`-separated absolute path.
    expect(lastPathSegment('/data/worktrees/abc/cosmic-dolphin')).toBe('cosmic-dolphin');
    expect(lastPathSegment('C:\\Users\\u\\AppData\\Local\\worktrees\\abc\\cosmic-dolphin')).toBe('cosmic-dolphin');
    expect(lastPathSegment('wt/nested/branch')).toBe('branch');
  });

  test('a trailing separator names the same thing', () => {
    expect(lastPathSegment('/data/worktrees/abc/cosmic-dolphin/')).toBe('cosmic-dolphin');
    expect(lastPathSegment('C:\\worktrees\\abc\\cosmic-dolphin\\')).toBe('cosmic-dolphin');
  });

  test('nothing to name is empty, not a stray separator', () => {
    expect(lastPathSegment(undefined)).toBe('');
    expect(lastPathSegment(null)).toBe('');
    expect(lastPathSegment('')).toBe('');
    expect(lastPathSegment('/')).toBe('');
  });
});
