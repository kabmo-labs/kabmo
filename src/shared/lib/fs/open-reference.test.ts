/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a chat file reference actually lives.
 *
 * The ambiguous case is the reason this module is pure and tested on its own:
 * `index.ts` matching two folders must NOT pick one, and a bare name with no
 * match must still open so the editor reports the missing file.
 */

import { describe, expect, test } from 'bun:test';
import { chooseFileTarget } from '@/shared/lib/fs/open-reference';

describe('chooseFileTarget', () => {
  test('a path with a directory opens as written, without consulting the index', () => {
    expect(chooseFileTarget({ path: 'src/client/App.tsx' }, [])).toEqual({
      kind: 'open',
      path: 'src/client/App.tsx',
    });
  });

  test('the line rides along on every open', () => {
    expect(chooseFileTarget({ path: 'src/a.ts', line: 7 }, [])).toEqual({
      kind: 'open',
      path: 'src/a.ts',
      line: 7,
    });
  });

  test('an exact root file wins over copies deeper in the tree', () => {
    const entries = [{ path: 'AGENTS.md' }, { path: 'docs/AGENTS.md' }];
    expect(chooseFileTarget({ path: 'AGENTS.md' }, entries)).toEqual({
      kind: 'open',
      path: 'AGENTS.md',
    });
  });

  test('one basename match resolves to its real path', () => {
    const entries = [{ path: 'src/client/App.tsx' }, { path: 'src/server/read.ts' }];
    expect(chooseFileTarget({ path: 'App.tsx', line: 3 }, entries)).toEqual({
      kind: 'open',
      path: 'src/client/App.tsx',
      line: 3,
    });
  });

  test('several matches open the picker instead of guessing', () => {
    const entries = [{ path: 'src/a/index.ts' }, { path: 'src/b/index.ts' }];
    expect(chooseFileTarget({ path: 'index.ts' }, entries)).toEqual({
      kind: 'pick',
      query: 'index.ts',
    });
  });

  test('no match opens the reference as written, so the editor reports it', () => {
    expect(chooseFileTarget({ path: 'Missing.tsx' }, [{ path: 'src/App.tsx' }])).toEqual({
      kind: 'literal',
      path: 'Missing.tsx',
    });
  });
});
