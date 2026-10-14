/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The unmerged-vocabulary table and the conflict-marker reader.
 *
 * These are the two rules every conflict surface reads from, and both encode a
 * fact that is invisible in the code that consumes them:
 *
 *  - a porcelain pair like `UU` is the two SIDES of a conflict, not an
 *    index/worktree pair, so `isUnmergedCode` is what stops `getGitStatusInfo`
 *    and `ChangesList` from reading one through the other's rules;
 *  - `--ours`/`--theirs` are INVERTED during a rebase, so the words on a resolve
 *    button have to come from the file's own markers rather than from those two
 *    names.
 */

import { describe, expect, test } from 'bun:test';
import {
  OPERATION_LABELS,
  UNMERGED_CODES,
  isUnmergedCode,
  parseConflictMarkers,
} from '@/shared/lib/fs/git-unmerged';

describe('isUnmergedCode', () => {
  test('accepts exactly the seven unmerged pairs', () => {
    for (const code of Object.keys(UNMERGED_CODES)) {
      expect(isUnmergedCode(code)).toBe(true);
    }
    expect(Object.keys(UNMERGED_CODES).sort()).toEqual(['AA', 'AU', 'DD', 'DU', 'UA', 'UD', 'UU']);
  });

  test('rejects a clean-status code and the one-letter legacy spellings', () => {
    // The clean codes reach the same presenter (the diff panel, the editor
    // tabs), and a case-folded match would claim them as conflicts.
    for (const code of ['M', 'A', 'D', 'U', '?', '??', ' M', 'M ', 'MM', 'R', 'C', 'uu', '']) {
      expect(isUnmergedCode(code)).toBe(false);
    }
  });

  test('rejects a non-string', () => {
    expect(isUnmergedCode(undefined)).toBe(false);
    expect(isUnmergedCode(null)).toBe(false);
    expect(isUnmergedCode(42)).toBe(false);
    expect(isUnmergedCode({})).toBe(false);
  });

  test('narrows, so the table can be indexed', () => {
    const code: unknown = 'UU';
    // The guard is what makes this type-check; a plain lookup could not.
    expect(isUnmergedCode(code) ? UNMERGED_CODES[code] : null).toBe('Conflicted — both modified');
  });
});

describe('parseConflictMarkers', () => {
  test('reads both side labels out of a real conflict block', () => {
    const text = [
      'line one',
      '<<<<<<< HEAD',
      'MAIN',
      '=======',
      'FEATURE',
      '>>>>>>> feature/payments',
      'line three',
    ].join('\n');
    expect(parseConflictMarkers(text)).toEqual({ ours: 'HEAD', theirs: 'feature/payments' });
  });

  test('a rebase writes a commit subject as the theirs label', () => {
    // Measured: `>>>>>>> a563c8a (main)` — the label is not always a branch name,
    // which is exactly why the buttons copy it verbatim instead of prettifying.
    const text = '<<<<<<< HEAD\nFEAT\n=======\nMAIN\n>>>>>>> a563c8a (main)\n';
    expect(parseConflictMarkers(text)).toEqual({ ours: 'HEAD', theirs: 'a563c8a (main)' });
  });

  test('a file with no markers answers an empty pair, not a guess', () => {
    // The caller falls back to the words ours/theirs on `{}`; inventing a label
    // would put a name on a button that does not match the file.
    expect(parseConflictMarkers('plain\ncontent\n')).toEqual({});
    expect(parseConflictMarkers('')).toEqual({});
  });

  test('reads only the FIRST block', () => {
    const text = [
      '<<<<<<< HEAD', 'A', '=======', 'B', '>>>>>>> first',
      'middle',
      '<<<<<<< HEAD', 'C', '=======', 'D', '>>>>>>> second',
    ].join('\n');
    // One dialog answers one file, and the first block is the one the reader met.
    expect(parseConflictMarkers(text)).toEqual({ ours: 'HEAD', theirs: 'first' });
  });

  test('a marker with no label yields undefined for that side', () => {
    // A bare `<<<<<<<` (no trailing text) is legal; the caller's `|| 'ours'`
    // fallback is what turns it into a usable word.
    const markers = parseConflictMarkers('<<<<<<<\nA\n=======\nB\n>>>>>>>\n');
    expect(markers.ours).toBeUndefined();
    expect(markers.theirs).toBeUndefined();
  });

  test('does not treat a marker mid-line as one', () => {
    // `startsWith` is the rule: git writes markers at column 0, and a line that
    // merely mentions one must not be read as a side.
    const text = 'code: <<<<<<< HEAD is the marker\n>>>>>>> not-a-side either\n';
    expect(parseConflictMarkers(text)).toEqual({ theirs: 'not-a-side either' });
  });
});

describe('OPERATION_LABELS', () => {
  test('names every operation, including the two rebase spellings', () => {
    // `rebase-merge` and `rebase-apply` are different FILES but the same word to
    // a reader, so the bar says "rebase" for both.
    expect(OPERATION_LABELS.merge).toBe('merge');
    expect(OPERATION_LABELS.rebase).toBe('rebase');
    expect(OPERATION_LABELS['rebase-apply']).toBe('rebase');
    expect(OPERATION_LABELS['cherry-pick']).toBe('cherry-pick');
    expect(OPERATION_LABELS.revert).toBe('revert');
    expect(OPERATION_LABELS['stash-pop']).toBe('stash pop');
  });
});
