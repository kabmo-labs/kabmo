/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `pathFromFileUrl` — the platform-specific half of a dropped-file reference.
 *
 * Pinned here rather than through the scope route because the Windows case is
 * invisible on the machine this repository is developed on: the route's own test
 * is `testPosix`, so the drive-letter branch had no test at all until a Windows
 * CI run refused every dropped file.
 */

import { describe, expect, test } from 'bun:test';
import { pathFromFileUrl } from '@/shared/lib/fs/file-url';

describe('pathFromFileUrl', () => {
  test('a POSIX file URL decodes to the path it names', () => {
    expect(pathFromFileUrl('file:///tmp/x/b.ts')).toBe('/tmp/x/b.ts');
  });

  test('a percent-encoded space is decoded', () => {
    expect(pathFromFileUrl('file:///tmp/x/My%20Notes.md')).toBe('/tmp/x/My Notes.md');
  });

  test('a Windows drive letter loses the leading slash, in every spelling', () => {
    // All three forms answer `/C:/…` from `new URL().pathname`, and a leading
    // slash on win32 resolves against the CURRENT DRIVE's root — a path no
    // workspace contains.
    expect(pathFromFileUrl('file:///C:/Users/x/b.ts')).toBe('C:/Users/x/b.ts');
    expect(pathFromFileUrl('file://C:/Users/x/b.ts')).toBe('C:/Users/x/b.ts');
    expect(pathFromFileUrl('file://C:\\Users\\x\\b.ts')).toBe('C:/Users/x/b.ts');
  });

  test('a percent-encoded drive path is decoded before the slash is dropped', () => {
    expect(pathFromFileUrl('file:///D:/a/My%20Notes.md')).toBe('D:/a/My Notes.md');
  });

  test('a path that is not a file URL is refused rather than guessed at', () => {
    expect(pathFromFileUrl('/tmp/x/b.ts')).toBeNull();
    expect(pathFromFileUrl('https://example.com/x.ts')).toBeNull();
  });

  test('a malformed escape is refused, not thrown', () => {
    expect(pathFromFileUrl('file:///tmp/%E0%A4%A')).toBeNull();
  });

  test('a lowercase drive letter is kept as written', () => {
    expect(pathFromFileUrl('file:///c:/x/b.ts')).toBe('c:/x/b.ts');
  });
});
