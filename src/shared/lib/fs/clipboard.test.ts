/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The clipboard rules both ends share.
 *
 * Each case here is a rule a naive implementation gets wrong in a way that is
 * invisible until it destroys something: a name ladder that appends the suffix
 * after the extension (`report.md copy`, which every editor reads as a new file
 * type), a paste onto an existing name that overwrites it, and a folder pasted
 * into its own subtree (which cannot terminate).
 */

import { describe, expect, test } from 'bun:test';
import {
  dropRefusal,
  duplicateName,
  fsClipboardScope,
  parentOf,
  pasteRefusal,
  pasteTargetDir,
  readFsClipboard,
  transferRefusal,
  uniqueName,
  type FsClipboard,
} from '@/shared/lib/fs/clipboard';

const clip = (over: Partial<FsClipboard> = {}): FsClipboard => ({
  scope: 'ws\u0000.',
  path: 'src/a.ts',
  name: 'a.ts',
  kind: 'file',
  mode: 'copy',
  ...over,
});

describe('uniqueName', () => {
  test('returns the name unchanged when it is free', () => {
    expect(uniqueName('a.ts', () => false)).toBe('a.ts');
  });

  test('keeps the extension at the end of the copy name', () => {
    // `report.v2.md copy` reads as a different file type; `report.v2 copy.md`
    // does not. The extension is what an editor keys off.
    const taken = new Set(['report.v2.md']);
    expect(uniqueName('report.v2.md', (c) => taken.has(c))).toBe('report.v2 copy.md');
  });

  test('walks to the first free numbered copy', () => {
    const taken = new Set(['a.ts', 'a copy.ts', 'a copy 2.ts']);
    expect(uniqueName('a.ts', (c) => taken.has(c))).toBe('a copy 3.ts');
  });

  test('a dot-file is treated as having no extension', () => {
    const taken = new Set(['.env']);
    expect(uniqueName('.env', (c) => taken.has(c))).toBe('.env copy');
  });
});

describe('duplicateName', () => {
  test('a file takes the copy ladder', () => {
    const taken = new Set(['a.ts']);
    expect(duplicateName('a.ts', 'file', (c) => taken.has(c))).toBe('a copy.ts');
  });

  test('a folder takes `name copy`, with no extension to preserve', () => {
    const taken = new Set(['src']);
    expect(duplicateName('src', 'folder', (c) => taken.has(c))).toBe('src copy');
    expect(duplicateName('src', 'folder', (c) => c === 'src copy')).toBe('src copy 2');
  });
});

describe('pasteTargetDir', () => {
  test('a folder is its own destination; a file’s is its directory', () => {
    expect(pasteTargetDir('src', 'folder')).toBe('src');
    expect(pasteTargetDir('src/deep/a.ts', 'file')).toBe('src/deep');
    expect(pasteTargetDir('a.ts', 'file')).toBe('.');
  });
});

describe('transferRefusal', () => {
  test('allows a folder pasted beside itself and into a sibling', () => {
    expect(transferRefusal({ path: 'src', kind: 'folder' }, '.')).toBeNull();
    expect(transferRefusal({ path: 'src', kind: 'folder' }, 'other')).toBeNull();
  });

  test('refuses a folder pasted into its own subtree — which cannot terminate', () => {
    expect(transferRefusal({ path: 'src', kind: 'folder' }, 'src')).toBe('Cannot paste a folder into itself');
    expect(transferRefusal({ path: 'src', kind: 'folder' }, 'src/deep')).toBe('Cannot paste a folder into itself');
  });

  test('a FILE may land inside a folder of the same name — no recursion to guard', () => {
    expect(transferRefusal({ path: 'src', kind: 'file' }, 'src')).toBeNull();
  });

  test('refuses the root itself as a source', () => {
    expect(transferRefusal({ path: '.', kind: 'folder' }, 'src')).toContain('workspace root');
    expect(transferRefusal({ path: '', kind: 'folder' }, '.')).toContain('workspace root');
  });
});

describe('parentOf', () => {
  test('a nested path names its directory; a top-level one names the root', () => {
    expect(parentOf('src/deep/a.ts')).toBe('src/deep');
    expect(parentOf('src')).toBe('.');
    expect(parentOf('a.ts')).toBe('.');
  });
});

describe('dropRefusal', () => {
  test('allows a drop into a sibling folder and onto the root', () => {
    expect(dropRefusal({ path: 'src/a.ts', kind: 'file' }, 'other')).toBeNull();
    expect(dropRefusal({ path: 'src/a.ts', kind: 'file' }, '.')).toBeNull();
    expect(dropRefusal({ path: 'src', kind: 'folder' }, 'other')).toBeNull();
  });

  test('refuses a drop into the folder the entry already lives in', () => {
    // A drag is a move, so this is a no-op with nothing to report — and
    // `dragover` must not draw a drop cursor for it.
    expect(dropRefusal({ path: 'src/a.ts', kind: 'file' }, 'src')).toBe('Already in this folder');
    expect(dropRefusal({ path: 'a.ts', kind: 'file' }, '.')).toBe('Already in this folder');
    expect(dropRefusal({ path: 'src', kind: 'folder' }, '.')).toBe('Already in this folder');
  });

  test('refuses a folder dropped into its own subtree', () => {
    expect(dropRefusal({ path: 'src', kind: 'folder' }, 'src/deep')).toContain('itself');
  });
});

describe('pasteRefusal', () => {
  test('reports an empty clipboard rather than pasting nothing', () => {
    expect(pasteRefusal(null, 'ws\u0000.', '.')).toBe('Nothing to paste');
  });

  test('refuses an entry taken from another listing', () => {
    expect(pasteRefusal(clip({ scope: 'other\u0000.' }), 'ws\u0000.', '.')).toContain('another workspace');
  });

  test('allows a paste of this listing’s entry and applies the folder rule', () => {
    expect(pasteRefusal(clip(), 'ws\u0000.', 'other')).toBeNull();
    expect(pasteRefusal(clip({ path: 'src', kind: 'folder' }), 'ws\u0000.', 'src/sub')).toContain('itself');
  });

  test('a CUT into its own folder is refused; a COPY into it is how a copy is made', () => {
    // The two modes differ here on purpose: copying a file into the directory
    // it already lives in is how `a copy.ts` is produced, while a cut there
    // would have nothing to do.
    expect(pasteRefusal(clip({ path: 'src/a.ts', mode: 'cut' }), 'ws\u0000.', 'src')).toBe('Already in this folder');
    expect(pasteRefusal(clip({ path: 'src/a.ts', mode: 'copy' }), 'ws\u0000.', 'src')).toBeNull();
  });
});

describe('fsClipboardScope', () => {
  test('separates root from repo, and treats a missing root as empty', () => {
    expect(fsClipboardScope('/ws', '.')).toBe('/ws\u0000.');
    expect(fsClipboardScope(undefined, 'sub')).toBe('\u0000sub');
    expect(fsClipboardScope('/ws', '.')).not.toBe(fsClipboardScope('/ws', 'sub'));
  });
});

describe('readFsClipboard', () => {
  test('accepts a well-formed entry', () => {
    expect(readFsClipboard(clip())).toEqual(clip());
  });

  test('rejects a path that names no child of the listing root', () => {
    // Every one of these would resolve outside the folder the entry claims.
    for (const path of ['.', '', '..', 'a/../b', '/etc/passwd', 'a//b']) {
      expect(readFsClipboard(clip({ path }))).toBeNull();
    }
  });

  test('rejects a blob whose shape Cut/Copy never wrote', () => {
    expect(readFsClipboard(null)).toBeNull();
    expect(readFsClipboard('a.ts')).toBeNull();
    expect(readFsClipboard({ path: 'a.ts', name: 'a.ts', scope: 's', kind: 'file' })).toBeNull();
    expect(readFsClipboard({ path: 'a.ts', name: 'a.ts', scope: 's', mode: 'copy' })).toBeNull();
    expect(readFsClipboard({ path: 'a.ts', name: 'a.ts', scope: 's', kind: 'file', mode: 'move' })).toBeNull();
  });
});
