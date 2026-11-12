/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The archive naming rules the dialog and the route both read.
 *
 * The suffix table is the one that decides whether a right-click offers
 * Extract, so a `.tar.gz` read as `.gz` would unpack one gzip layer and leave a
 * tarball behind. The default names are what the Compress dialog shows before
 * the user types, and a wrong one (naming a multi-selection after its first
 * file) hides what the archive holds.
 */

import { describe, expect, test } from 'bun:test';
import {
  archiveExtension,
  archiveKindOf,
  archiveKindLabel,
  defaultArchiveDestination,
  defaultArchiveName,
  defaultExtractDestination,
  isArchiveName,
  commonParentDir,
  stripArchiveSuffix,
} from '@/shared/lib/fs/archive';

const file = (path: string, name = path.split('/').pop() ?? path) => ({ path, name, kind: 'file' as const });

describe('archiveKindOf', () => {
  test('reads the longest suffix first', () => {
    expect(archiveKindOf('src.tar.gz')).toBe('tar.gz');
    expect(archiveKindOf('src.tgz')).toBe('tar.gz');
    expect(archiveKindOf('src.tar.bz2')).toBe('tar.bz2');
    expect(archiveKindOf('src.tar.xz')).toBe('tar.xz');
    expect(archiveKindOf('src.tar')).toBe('tar');
  });

  test('recognises every single-file compressor', () => {
    expect(archiveKindOf('a.zip')).toBe('zip');
    expect(archiveKindOf('a.7z')).toBe('7z');
    expect(archiveKindOf('a.rar')).toBe('rar');
    expect(archiveKindOf('a.gz')).toBe('gz');
    expect(archiveKindOf('a.bz2')).toBe('bz2');
    expect(archiveKindOf('a.xz')).toBe('xz');
  });

  test('is case-insensitive and rejects a normal file', () => {
    expect(archiveKindOf('SRC.ZIP')).toBe('zip');
    expect(archiveKindOf('main.ts')).toBeNull();
    expect(archiveKindOf('zip')).toBeNull();
    expect(isArchiveName('photo.ZIP')).toBe(true);
    expect(isArchiveName('notes.md')).toBe(false);
  });

  test('labels the kind for the dialog', () => {
    expect(archiveKindLabel('tar.gz')).toBe('TAR.GZ');
  });
});

describe('stripArchiveSuffix', () => {
  test('removes the whole archive suffix', () => {
    expect(stripArchiveSuffix('src.tar.gz')).toBe('src');
    expect(stripArchiveSuffix('src.zip')).toBe('src');
    expect(stripArchiveSuffix('main.ts')).toBe('main.ts');
  });
});

describe('defaultArchiveName', () => {
  test('one file keeps its stem, one folder its own name', () => {
    expect(defaultArchiveName([file('src/report.pdf', 'report.pdf')], 'zip')).toBe('report.zip');
    expect(defaultArchiveName([{ path: 'src', name: 'src', kind: 'folder' }], 'tar.gz')).toBe('src.tar.gz');
  });

  test('a multi-selection takes the name of the folder that holds it', () => {
    expect(defaultArchiveName([file('src/a.ts'), file('src/b.ts')], '7z')).toBe('src.7z');
    // Different branches share the root, which is the common folder.
    expect(defaultArchiveName([file('src/a.ts'), file('docs/b.md')], 'zip')).toBe('archive.zip');
  });

  test('format extension follows the chosen format', () => {
    expect(archiveExtension('rar')).toBe('rar');
    expect(archiveExtension('tar.gz')).toBe('tar.gz');
  });
});

describe('commonParentDir and destinations', () => {
  test('finds the deepest shared folder', () => {
    expect(commonParentDir(['src/a.ts', 'src/b.ts'])).toBe('src');
    expect(commonParentDir(['src/deep/a.ts', 'src/deep/b.ts'])).toBe('src/deep');
    expect(commonParentDir(['src/a.ts', 'docs/b.md'])).toBe('.');
    expect(commonParentDir([])).toBe('.');
  });

  test('compress lands beside the selection; extract lands in a stem folder', () => {
    expect(defaultArchiveDestination([file('src/a.ts')])).toBe('src');
    expect(defaultExtractDestination('src/bundle.zip')).toBe('src/bundle');
    expect(defaultExtractDestination('bundle.tar.gz')).toBe('bundle');
  });
});
