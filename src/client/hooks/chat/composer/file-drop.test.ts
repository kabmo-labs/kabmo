/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dropped-directory resolution for the composer.
 *
 * The browser APIs this reads (`webkitGetAsEntry`, `readEntries`) are awkward
 * in ways that fail silently: a directory's `dataTransfer.files` entry is a
 * size-0 stub, and `readEntries` returns at most 100 children per call, so a
 * single call looks like a complete directory of ≤100 files. These tests pin
 * the contract those quirks break — recursive expansion, paged reads, and the
 * caps that keep a dropped repo root from queueing thousands of attachments.
 */

import { describe, expect, test } from 'bun:test';
import { carriesBytes } from '@/client/hooks/chat/composer/file-drop';
import {
  expandDroppedFiles,
  readDroppedEntries,
  MAX_DROPPED_FILES,
} from '@/client/hooks/chat/composer/drop-entries';

function fileEntry(name: string, content = 'x'): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(new File([content], name, { type: 'text/plain' })),
  } as unknown as FileSystemFileEntry;
}

/** Directory whose reader hands back `children` in fixed-size batches. */
function dirEntry(name: string, children: FileSystemEntry[], batchSize = 100): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(cursor, cursor + batchSize);
          cursor += batchSize;
          ok(batch);
        },
      } as unknown as FileSystemDirectoryReader;
    },
  } as unknown as FileSystemDirectoryEntry;
}

function fakeDataTransfer(
  items: { entry: FileSystemEntry | null; file?: File }[],
  files: File[] = [],
): DataTransfer {
  return {
    items: items.map(({ entry, file }) => ({
      kind: 'file',
      webkitGetAsEntry: () => entry,
      getAsFile: () => file ?? null,
    })),
    files,
  } as unknown as DataTransfer;
}

describe('readDroppedEntries', () => {
  // The two views are not interchangeable: the item entry can carry correct
  // metadata over a backing store that no longer reads, while `files` hands over
  // one that does. A drop in an installed app window exposed exactly that — the
  // chip had the right name and size and its contents never arrived, because the
  // item-list File was the one being read.
  test('the file list wins over the item list when it holds bytes', () => {
    const fromItems = new File(['from items'], 'notes.md', { type: 'text/markdown' });
    const fromFiles = new File(['from files'], 'notes.md', { type: 'text/markdown' });
    const entries = readDroppedEntries(fakeDataTransfer([{ entry: fileEntry('notes.md'), file: fromItems }], [fromFiles]));

    expect(entries.files.length).toBe(1);
    expect(entries.files[0]).toBe(fromFiles);
  });

  // A 0-byte stub in `files` is how a DIRECTORY is listed, so taking it would
  // attach an empty file in place of the tree the walk is about to expand.
  test('a stub in the file list falls through to the item entry', () => {
    const stub = new File([], 'notes.md', { type: '' });
    const real = new File(['# Title\n\nBody'], 'notes.md', { type: 'text/markdown' });
    const entries = readDroppedEntries(fakeDataTransfer([{ entry: fileEntry('notes.md'), file: real }], [stub]));

    expect(entries.files.length).toBe(1);
    expect(entries.files[0].size).toBeGreaterThan(0);
  });

  test('falls back to the item list when the file list is empty', () => {
    const fromItems = new File(['item body'], 'only-items.txt', { type: 'text/plain' });
    const entries = readDroppedEntries(fakeDataTransfer([{ entry: fileEntry('only-items.txt'), file: fromItems }]));

    expect(entries.files.map((f) => f.name)).toEqual(['only-items.txt']);
  });

  test('stubs are kept when nothing else holds bytes', () => {
    const stub = new File([], 'from-a-page.txt', { type: 'text/plain' });
    const entries = readDroppedEntries(fakeDataTransfer([], [stub]));

    expect(entries.files.map((f) => f.name)).toEqual(['from-a-page.txt']);
  });

  test('passes plain files through untouched', async () => {
    const file = new File(['a'], 'a.txt', { type: 'text/plain' });
    const { files, incomplete } = await expandDroppedFiles(
      readDroppedEntries(fakeDataTransfer([{ entry: fileEntry('a.txt'), file }])),
    );
    expect(files.map((f: File) => f.name)).toEqual(['a.txt']);
    expect(incomplete).toBe(false);
  });

  test('expands a dropped directory recursively', async () => {
    const root = dirEntry('root', [
      fileEntry('a.txt'),
      dirEntry('sub', [fileEntry('b.txt'), dirEntry('deeper', [fileEntry('c.txt')])]),
    ]);
    const { files, incomplete } = await expandDroppedFiles(readDroppedEntries(fakeDataTransfer([{ entry: root }])));
    expect(files.map((f: File) => f.name).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(incomplete).toBe(false);
  });

  test('keeps paging past the 100-children-per-read limit', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`f${i}.txt`));
    const { files, incomplete } = await expandDroppedFiles(readDroppedEntries(fakeDataTransfer([{ entry: dirEntry('big', many) }])));
    expect(files.length).toBe(MAX_DROPPED_FILES);
    // More files existed than were taken, and the caller must be able to say so.
    expect(incomplete).toBe(true);
  });

  test('stops at the nesting cap instead of walking a cycle forever', async () => {
    let nested: FileSystemEntry = dirEntry('leaf', [fileEntry('deep.txt')]);
    for (let i = 0; i < 14; i += 1) nested = dirEntry(`wrap${i}`, [nested]);
    const { incomplete } = await expandDroppedFiles(readDroppedEntries(fakeDataTransfer([{ entry: nested }])));
    expect(incomplete).toBe(true);
  });

  test('falls back to the flat file list when no item entries exist', async () => {
    const listed = Array.from({ length: MAX_DROPPED_FILES + 10 }, (_, i) => new File(['x'], `g${i}.txt`));
    const { files, incomplete } = await expandDroppedFiles(readDroppedEntries(fakeDataTransfer([], listed)));
    expect(files.length).toBe(MAX_DROPPED_FILES);
    expect(incomplete).toBe(true);
  });

  test('tolerates a directory whose read fails', async () => {
    const broken = {
      isFile: false,
      isDirectory: true,
      name: 'broken',
      createReader: () => ({
        readEntries: (_ok: unknown, err?: (e: unknown) => void) => err?.(new Error('denied')),
      }),
    } as unknown as FileSystemDirectoryEntry;
    const { files, incomplete } = await expandDroppedFiles(readDroppedEntries(fakeDataTransfer([{ entry: broken }])));
    expect(files).toEqual([]);
    expect(incomplete).toBe(false);
  });
});

describe('carriesBytes', () => {
  test('a file whose declared size is 0 but holds bytes counts', async () => {
    // A .md dropped from Finder can report size 0 while its bytes are present.
    // Treating that as a "path stub" routed it to the reference resolver, which
    // only reads inside the allow-list — a file in ~/Downloads was refused with
    // no way for the user to tell why.
    const real = new File([new TextEncoder().encode('# Title\n\nBody')], 'notes.md', { type: '' });
    Object.defineProperty(real, 'size', { value: 0 });
    expect(real.size).toBe(0);
    expect(await carriesBytes([real])).toBe(true);
  });

  test('a declared size above zero is enough without reading', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.bin', { type: 'application/octet-stream' });
    expect(await carriesBytes([file])).toBe(true);
  });

  test('a genuine stub holds nothing, so the reference path still runs', async () => {
    const stub = new File([], 'from-a-web-page.txt', { type: 'text/plain' });
    expect(await carriesBytes([stub])).toBe(false);
  });

  test('one readable file in a batch is enough', async () => {
    const empty = new File([], 'empty.txt', { type: 'text/plain' });
    const real = new File([new Uint8Array([65])], 'real.txt', { type: 'text/plain' });
    expect(await carriesBytes([empty, real])).toBe(true);
  });

  test('an empty batch carries nothing', async () => {
    expect(await carriesBytes([])).toBe(false);
  });
});
