/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The quick-open ranking, and the index reader.
 *
 * The ranking is the feature: a picker that lists every file whose path contains the
 * query is not a picker, it is a filtered tree. The cases below are the ones that
 * distinguish a useful order from an alphabetical one.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
  fetchQuickOpenIndex,
  isSubsequence,
  quickOpenEntry,
  rankQuickOpen,
  scoreQuickOpen,
  type QuickOpenEntry,
} from '@/client/hooks/editor/quick-open';

const nativeFetch = Bun.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

const ENTRIES: QuickOpenEntry[] = [
  'src/client/hooks/editor/use-file-tabs.ts',
  'src/client/components/workspace/editor/Tabs.tsx',
  'src/shared/lib/code/editor/keymap.ts',
  'src/client/hooks/editor/quick-open.ts',
  'README.md',
].map(quickOpenEntry);

describe('quickOpenEntry', () => {
  test('splits the path into the name and the directory a row prints', () => {
    expect(quickOpenEntry('src/a/b.ts')).toEqual({ path: 'src/a/b.ts', name: 'b.ts', directory: 'src/a' });
  });

  test('a root-level file has no directory', () => {
    expect(quickOpenEntry('README.md')).toEqual({ path: 'README.md', name: 'README.md', directory: '' });
  });
});

describe('scoreQuickOpen', () => {
  test('an exact basename beats a prefix, which beats a substring', () => {
    const exact = scoreQuickOpen(quickOpenEntry('a/quick-open.ts'), 'quick-open.ts')!;
    const prefix = scoreQuickOpen(quickOpenEntry('a/quick-open.tsx'), 'quick-open')!;
    const inside = scoreQuickOpen(quickOpenEntry('a/xquick-open.ts'), 'quick-open')!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inside);
  });

  test('a basename hit always beats a directory-only hit', () => {
    // Typing a file's name must find the FILE, not every sibling in a folder named
    // after it — which is the failure a plain `path.includes` produces.
    const nameHit = scoreQuickOpen(quickOpenEntry('deep/nested/editor.ts'), 'editor')!;
    const dirHit = scoreQuickOpen(quickOpenEntry('editor/other.ts'), 'editor')!;
    expect(nameHit).toBeGreaterThan(dirHit);
  });

  test('shorter paths win ties, because the file you want is usually nearer the root', () => {
    const near = scoreQuickOpen(quickOpenEntry('a/keymap.ts'), 'keymap')!;
    const far = scoreQuickOpen(quickOpenEntry('a/b/c/d/e/keymap.ts'), 'keymap')!;
    expect(near).toBeGreaterThan(far);
  });

  test('an empty query matches everything with the same score', () => {
    expect(scoreQuickOpen(quickOpenEntry('a.ts'), '')).toBe(0);
  });

  test('a non-match is null, and a subsequence is the last resort', () => {
    expect(scoreQuickOpen(quickOpenEntry('src/a.ts'), 'zzz')).toBeNull();
    // `uft` is a subsequence of `use-file-tabs`, and it must still be found — that
    // is how people type an acronym for a long name.
    expect(scoreQuickOpen(quickOpenEntry('a/use-file-tabs.ts'), 'uft')).not.toBeNull();
  });
});

describe('isSubsequence', () => {
  test('matches characters in order, not contiguously', () => {
    expect(isSubsequence('uft', 'use-file-tabs')).toBe(true);
    expect(isSubsequence('tabs', 'use-file-tabs')).toBe(true);
    expect(isSubsequence('ftu', 'use-file-tabs')).toBe(false);
  });

  test('an empty needle matches', () => {
    expect(isSubsequence('', 'anything')).toBe(true);
  });
});

describe('rankQuickOpen', () => {
  test('returns the best matches first and respects the limit', () => {
    const ranked = rankQuickOpen(ENTRIES, 'tabs');
    expect(ranked[0].name).toBe('Tabs.tsx');
    expect(ranked.map((entry) => entry.path)).toContain('src/client/hooks/editor/use-file-tabs.ts');
    expect(rankQuickOpen(ENTRIES, 'tabs', 1)).toHaveLength(1);
  });

  test('an empty query lists the index in path order', () => {
    const ranked = rankQuickOpen(ENTRIES, '');
    expect(ranked).toHaveLength(ENTRIES.length);
    expect(ranked.map((entry) => entry.path)).toEqual([...ranked.map((entry) => entry.path)].sort());
  });

  test('a query that matches nothing answers an empty list', () => {
    expect(rankQuickOpen(ENTRIES, 'zzzz')).toEqual([]);
  });
});

describe('fetchQuickOpenIndex', () => {
  test('reads the flat index and shapes every row', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ files: [{ path: 'src/a.ts' }, { path: 'b/c.ts' }] }),
    })) as unknown as typeof fetch;
    expect(await fetchQuickOpenIndex('/repo')).toEqual([
      { path: 'src/a.ts', name: 'a.ts', directory: 'src' },
      { path: 'b/c.ts', name: 'c.ts', directory: 'b' },
    ]);
  });

  test('a refusal or a malformed row answers an empty list, never a throw', async () => {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await fetchQuickOpenIndex('/repo')).toEqual([]);

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ files: [{ path: 42 }, null, { path: 'ok.ts' }] }),
    })) as unknown as typeof fetch;
    // A row without a string path is dropped rather than rendered as `undefined`.
    expect((await fetchQuickOpenIndex('/repo')).map((entry) => entry.path)).toEqual(['ok.ts']);

    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchQuickOpenIndex('/repo')).toEqual([]);
  });
});
