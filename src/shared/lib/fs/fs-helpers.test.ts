/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the small fs-panel helpers: path joining, raw-URL building, tree
 * patching, and commit-row normalization.
 *
 * These helpers sit on boundaries where the inputs are untrusted. The raw URL
 * is what an image tab points its <img> at, so a dropped `root` or `repo`
 * silently loads a same-named file from the wrong directory. The tree helpers
 * decide whether an expand click collapses the user's other folders, which is
 * an identity question, not just a shape one. And `normalizeCommits` is the
 * last guard before rows cross from git's text output into the UI: a row with
 * no hash would otherwise duplicate on every "load more", so the drop rule is
 * pinned here.
 */

import { describe, expect, test } from 'bun:test';

import type { FsNode } from '@/shared/types';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { normalizeCommits } from '@/shared/lib/fs/commit-row';
import { rehydrateTree } from '@/shared/lib/fs/file-tree';
import { buildFsRawUrl, toAbsolutePath } from '@/shared/lib/fs/paths';

const file = (path: string): FsNode => ({ name: path.split('/').pop() ?? path, path, type: 'file' });
const folder = (path: string, children: FsNode[]): FsNode => ({
  name: path.split('/').pop() ?? path,
  path,
  type: 'folder',
  children,
});

describe('buildFsRawUrl', () => {
  test('a bare path carries only the path parameter', () => {
    expect(buildFsRawUrl({ path: 'a.ts' })).toBe('/api/fs/raw?path=a.ts');
  });

  test('the scope root and nested repo travel with the file', () => {
    expect(buildFsRawUrl({ path: 'a.png', root: '/w', repo: 'sub' })).toBe(
      '/api/fs/raw?path=a.png&root=%2Fw&repo=sub'
    );
  });

  test('repo "." is omitted: the server reads an absent repo as the scoped root', () => {
    expect(buildFsRawUrl({ path: 'a.png', root: '/w', repo: '.' })).toBe('/api/fs/raw?path=a.png&root=%2Fw');
  });

  test('an empty root or repo is omitted', () => {
    expect(buildFsRawUrl({ path: 'a.png', root: '', repo: '' })).toBe('/api/fs/raw?path=a.png');
  });

  test('spaces and reserved characters are encoded, not emitted raw', () => {
    expect(buildFsRawUrl({ path: 'my dir/a&b=c.ts' })).toBe('/api/fs/raw?path=my+dir%2Fa%26b%3Dc.ts');
  });
});

describe('toAbsolutePath', () => {
  test('a relative path is joined onto the base', () => {
    expect(toAbsolutePath('/root', 'src/a.ts')).toBe('/root/src/a.ts');
  });

  test('leading slashes and "./" are stripped from the relative half', () => {
    expect(toAbsolutePath('/root', '/src/a.ts')).toBe('/root/src/a.ts');
    expect(toAbsolutePath('/root', './src/a.ts')).toBe('/root/src/a.ts');
    expect(toAbsolutePath('/root', '///src/a.ts')).toBe('/root/src/a.ts');
  });

  test('a dotfile is a name, so its dot is not a "./" prefix', () => {
    expect(toAbsolutePath('/root', '.env')).toBe('/root/.env');
  });

  test('trailing separators on either half are trimmed', () => {
    expect(toAbsolutePath('/root/', 'src/')).toBe('/root/src');
    expect(toAbsolutePath('/root//', 'src/a.ts')).toBe('/root/src/a.ts');
  });

  test('a missing base leaves the relative path alone', () => {
    expect(toAbsolutePath(null, '/src/a.ts')).toBe('src/a.ts');
    expect(toAbsolutePath(undefined, 'src/a.ts')).toBe('src/a.ts');
    expect(toAbsolutePath('', 'src/a.ts')).toBe('src/a.ts');
  });

  test('an empty relative path resolves to the base itself', () => {
    expect(toAbsolutePath('/root', '')).toBe('/root');
    expect(toAbsolutePath('/root', '///')).toBe('/root');
  });

  test('no base and no relative path is the empty string', () => {
    expect(toAbsolutePath(null, '')).toBe('');
  });

  test('a Windows base is joined with a backslash', () => {
    expect(toAbsolutePath('C:\\proj', 'src')).toBe('C:\\proj\\src');
    expect(toAbsolutePath('C:\\proj\\', 'src')).toBe('C:\\proj\\src');
  });

  test('a mixed-separator base falls back to a forward slash', () => {
    expect(toAbsolutePath('C:\\proj/sub', 'src')).toBe('C:\\proj/sub/src');
  });

  test('parent segments are joined, not resolved', () => {
    // This is a join helper, not a normalizer: `..` is passed through.
    expect(toAbsolutePath('/root', '../a.ts')).toBe('/root/../a.ts');
  });

  test('a "." base is kept as written', () => {
    expect(toAbsolutePath('.', 'a.ts')).toBe('./a.ts');
  });
});

describe('rehydrateTree', () => {
  test('a cached folder gets its children back', () => {
    const cache = { a: [file('a/x.ts')] };
    const result = rehydrateTree([folder('a', [])], cache);
    expect(result[0].children?.map(c => c.path)).toEqual(['a/x.ts']);
  });

  test('nested cached folders are rehydrated recursively', () => {
    const cache = { a: [folder('a/b', []), file('a/y.ts')], 'a/b': [file('a/b/c.ts')] };
    const result = rehydrateTree([folder('a', [])], cache);
    const nested = result[0].children?.find((child) => child.path === 'a/b');
    expect(nested?.children?.map(c => c.path)).toEqual(['a/b/c.ts']);
  });

  test('an uncached folder keeps its own children untouched', () => {
    const node = folder('a', [file('a/x.ts')]);
    const result = rehydrateTree([node], {});
    expect(result[0].children?.[0]).toBe(node.children?.[0]);
  });

  test('a file node is returned as-is even when the cache names its path', () => {
    const node = file('a.ts');
    const cache = { 'a.ts': [file('nope.ts')] };
    expect(rehydrateTree([node], cache)[0]).toBe(node);
  });

  test('an empty cached listing is applied, collapsing the folder', () => {
    const result = rehydrateTree([folder('a', [file('a/x.ts')])], { a: [] });
    expect(result[0].children).toEqual([]);
  });
});

describe('normalizeCommits', () => {
  test('a non-array payload yields no commits', () => {
    expect(normalizeCommits(null)).toEqual([]);
    expect(normalizeCommits({ hash: 'a' })).toEqual([]);
  });

  test('a row without a hash is dropped rather than given a placeholder', () => {
    // An identity-less row cannot be deduplicated against the next page, so it
    // would duplicate on every "load more" if it survived.
    const rows = [{ message: 'no hash' }, { hash: '' }, { hash: 'abc', message: 'kept' }];
    expect(normalizeCommits(rows).map(c => c.hash)).toEqual(['abc']);
  });

  test('non-object rows are skipped', () => {
    expect(normalizeCommits([null, 'x', 7, { hash: 'h' }]).map(c => c.hash)).toEqual(['h']);
  });

  test('a missing shortHash is derived from the first eight characters', () => {
    const [commit] = normalizeCommits([{ hash: '0123456789abcdef' }]);
    expect(commit.shortHash).toBe('01234567');
  });

  test('an empty shortHash is treated as missing', () => {
    const [commit] = normalizeCommits([{ hash: '0123456789abcdef', shortHash: '' }]);
    expect(commit.shortHash).toBe('01234567');
  });

  test('a missing author becomes Unknown, but an explicit empty one is kept', () => {
    expect(normalizeCommits([{ hash: 'h' }])[0].author).toBe('Unknown');
    expect(normalizeCommits([{ hash: 'h', author: '' }])[0].author).toBe('');
  });

  test('date falls back to the time field, then to empty', () => {
    expect(normalizeCommits([{ hash: 'h', date: 'D' }])[0].date).toBe('D');
    expect(normalizeCommits([{ hash: 'h', time: 'T' }])[0].date).toBe('T');
    expect(normalizeCommits([{ hash: 'h' }])[0].date).toBe('');
    expect(normalizeCommits([{ hash: 'h', date: 'D', time: 'T' }])[0].date).toBe('D');
  });

  test('message and refs default to empty values', () => {
    const [commit] = normalizeCommits([{ hash: 'h' }]);
    expect(commit.message).toBe('');
    expect(commit.body).toBeUndefined();
    expect(commit.parents).toEqual([]);
    expect(commit.refs).toEqual([]);
    expect(commit.files).toEqual([]);
    expect(commit.lane).toBeUndefined();
  });

  test('a body is carried through and a non-string one is dropped', () => {
    expect(normalizeCommits([{ hash: 'h', body: 'why\nmore' }])[0].body).toBe('why\nmore');
    expect(normalizeCommits([{ hash: 'h', body: 7 }])[0].body).toBeUndefined();
  });

  test('non-string parents and refs are filtered out', () => {
    const [commit] = normalizeCommits([{ hash: 'h', parents: ['a', 1, null, 'b'], refs: ['HEAD', 2] }]);
    expect(commit.parents).toEqual(['a', 'b']);
    expect(commit.refs).toEqual(['HEAD']);
  });

  test('a numeric lane is kept, including zero', () => {
    expect(normalizeCommits([{ hash: 'h', lane: 0 }])[0].lane).toBe(0);
    expect(normalizeCommits([{ hash: 'h', lane: 3 }])[0].lane).toBe(3);
    expect(normalizeCommits([{ hash: 'h', lane: '3' }])[0].lane).toBeUndefined();
  });
});

describe('normalizeCommits: changed-file rows', () => {
  test('rows without a file name are dropped', () => {
    const [commit] = normalizeCommits([{ hash: 'h', files: [{ additions: 1 }, null, { file: 'a.ts' }] }]);
    expect(commit.files?.map(f => f.file)).toEqual(['a.ts']);
  });

  test('a missing status becomes M and a missing diff stays undefined', () => {
    const [commit] = normalizeCommits([{ hash: 'h', files: [{ file: 'a.ts' }] }]);
    expect(commit.files?.[0]).toEqual({
      file: 'a.ts',
      status: 'M',
      additions: 0,
      deletions: 0,
      diff: undefined,
    });
  });

  test('string counts from a cached payload are coerced to zero', () => {
    // `git log --numstat` prints `-` for binaries; a cached row may carry the
    // raw string, and `'12'` must not reach the UI as a count.
    const [commit] = normalizeCommits([
      { hash: 'h', files: [{ file: 'a.bin', additions: '12', deletions: '-' }] },
    ]);
    expect(commit.files?.[0].additions).toBe(0);
    expect(commit.files?.[0].deletions).toBe(0);
  });

  test('non-finite counts are zeroed', () => {
    const [commit] = normalizeCommits([
      { hash: 'h', files: [{ file: 'a.ts', additions: Number.NaN, deletions: Number.POSITIVE_INFINITY }] },
    ]);
    expect(commit.files?.[0].additions).toBe(0);
    expect(commit.files?.[0].deletions).toBe(0);
  });

  test('real counts and a diff are preserved, including an empty diff', () => {
    const [commit] = normalizeCommits([
      { hash: 'h', files: [{ file: 'a.ts', status: 'A', additions: 3, deletions: 1, diff: '' }] },
    ]);
    expect(commit.files?.[0]).toEqual({
      file: 'a.ts',
      status: 'A',
      additions: 3,
      deletions: 1,
      diff: '',
    });
  });

  test('a non-array files field becomes an empty list', () => {
    expect(normalizeCommits([{ hash: 'h', files: 'nope' }])[0].files).toEqual([]);
  });
});

describe('COMMIT_PAGE_SIZE', () => {
  test('is the 50-row page the server and the infinite-scroll fallback share', () => {
    // The client falls back to `data.length === COMMIT_PAGE_SIZE` when a
    // response omits `hasMore`, so this literal is a wire contract.
    expect(COMMIT_PAGE_SIZE).toBe(50);
  });
});
