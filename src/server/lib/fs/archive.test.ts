/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The archive verbs against the real system tools.
 *
 * The formats are gated on `Bun.which` so the suite measures the machine it
 * runs on instead of assuming `rar` exists: a CI image without `7z` must skip
 * that case, not fail. The round trips are the point — a command that exits 0
 * but stores the wrong paths is exactly what a naming bug looks like.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { compressEntries, compressFormats, extractArchive, findTool } from '@/server/lib/fs/archive';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-archive-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

const hasZip = Bun.which('zip') !== null && Bun.which('unzip') !== null;
const hasTar = Bun.which('tar') !== null;
const hasGzip = Bun.which('gzip') !== null;

describe('compressFormats', () => {
  test('names the tool each format needs and whether it is installed', () => {
    const formats = compressFormats();
    expect(formats.map((format) => format.id)).toEqual(['zip', '7z', 'rar', 'tar', 'tar.gz']);
    for (const format of formats) {
      expect(format.tool).toBeTruthy();
      expect(typeof format.available).toBe('boolean');
    }
    expect(formats.find((format) => format.id === 'zip')?.available).toBe(Bun.which('zip') !== null);
    expect(findTool(['definitely-not-a-binary'])).toBeNull();
  });
});

describe('compressEntries / extractArchive', () => {
  test.skipIf(!hasZip)('a zip round-trips the selected entries', async () => {
    const a = write('src/a.ts', 'A');
    write('src/deep/b.ts', 'B');
    const destinationDir = path.join(dir, 'src');

    const compressed = await compressEntries({
      destinationDir,
      name: 'bundle.zip',
      format: 'zip',
      sources: [a, path.join(destinationDir, 'deep')],
    });
    expect(compressed.ok).toBe(true);
    expect(fs.existsSync(path.join(destinationDir, 'bundle.zip'))).toBe(true);

    const out = path.join(dir, 'unpacked');
    const extracted = await extractArchive({ archivePath: path.join(destinationDir, 'bundle.zip'), destinationDir: out });
    expect(extracted.ok).toBe(true);
    expect(fs.readFileSync(path.join(out, 'a.ts'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(out, 'deep/b.ts'), 'utf8')).toBe('B');
  });

  test.skipIf(!hasTar)('a tar.gz round-trips a folder', async () => {
    write('src/a.ts', 'A');
    const destinationDir = dir;
    const compressed = await compressEntries({
      destinationDir,
      name: 'src.tar.gz',
      format: 'tar.gz',
      sources: [path.join(dir, 'src')],
    });
    expect(compressed.ok).toBe(true);

    const out = path.join(dir, 'unpacked');
    const extracted = await extractArchive({ archivePath: path.join(dir, 'src.tar.gz'), destinationDir: out });
    expect(extracted.ok).toBe(true);
    expect(fs.readFileSync(path.join(out, 'src/a.ts'), 'utf8')).toBe('A');
  });

  test.skipIf(!hasGzip)('a single .gz file decompresses to its stem', async () => {
    const archive = write('notes.txt.gz', '');
    fs.writeFileSync(archive, gzipSync('hello'));

    const out = path.join(dir, 'out');
    const extracted = await extractArchive({ archivePath: archive, destinationDir: out });
    expect(extracted.ok).toBe(true);
    expect(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8')).toBe('hello');
  });

  test('refuses a destination that already exists', async () => {
    const source = write('src/a.ts', 'A');
    write('src/bundle.zip', 'not really a zip');

    const outcome = await compressEntries({
      destinationDir: path.join(dir, 'src'),
      name: 'bundle.zip',
      format: 'zip',
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('already exists');
  });

  test('refuses a source outside the destination folder', async () => {
    const source = write('other/a.ts', 'A');
    const outcome = await compressEntries({
      destinationDir: path.join(dir, 'src'),
      name: 'bundle.zip',
      format: 'zip',
      sources: [source],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('contains every selected item');
  });

  test('refuses a file that is not an archive', async () => {
    const archive = write('notes.txt', 'hello');
    const outcome = await extractArchive({ archivePath: archive, destinationDir: path.join(dir, 'out') });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(400);
  });
});
