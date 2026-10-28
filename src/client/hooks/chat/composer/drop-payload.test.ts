/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a drop's payload.
 *
 * Hosts describe a dragged file in incompatible ways, and the difference decides
 * whether the drop is accepted at all. Two failures this pins:
 *
 * - Gating on the `Files` type alone rejected every drag that carries no File —
 *   a download dragged out of WhatsApp Web offers only a URL in `DownloadURL`,
 *   and a bare path arrives as `text/plain`.
 * - Accepting `text/plain` on its own would turn every text selection into a
 *   file drag, so a path-bearing payload only counts when it actually looks like
 *   a path or URL.
 */

import { describe, expect, test } from 'bun:test';
import { collectDroppedFileUris, hasDraggedFiles } from '@/client/hooks/chat/composer/drop-payload';

function transfer(types: Record<string, string>, files: File[] = [], items: DataTransferItem[] = []): DataTransfer {
  return {
    types: Object.keys(types),
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    getData: (type: string) => types[type] ?? types[type.toLowerCase()] ?? '',
  } as unknown as DataTransfer;
}

describe('hasDraggedFiles', () => {
  test('a real file list is always a file drag', () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    expect(hasDraggedFiles(transfer({}, [file]))).toBe(true);
  });

  test('a browser download with no File is still a file drag', () => {
    // WhatsApp Web / Gmail / Slack: the payload is a URL, nothing else.
    expect(hasDraggedFiles(transfer({
      'text/plain': 'https://web.whatsapp.com/download/xyz.txt',
      DownloadURL: 'text/plain:xyz.txt:https://web.whatsapp.com/download/xyz.txt',
    }))).toBe(true);
  });

  test('a uri-list is a file drag', () => {
    expect(hasDraggedFiles(transfer({ 'text/uri-list': 'file:///repo/a.ts' }))).toBe(true);
  });

  test('a bare absolute path is a file drag', () => {
    expect(hasDraggedFiles(transfer({ 'text/plain': '/repo/a.ts' }))).toBe(true);
    expect(hasDraggedFiles(transfer({ 'text/plain': '~/notes.md' }))).toBe(true);
    expect(hasDraggedFiles(transfer({ 'text/plain': 'C:\\repo\\a.ts' }))).toBe(true);
  });

  test('selected prose is NOT a file drag', () => {
    // Otherwise every text selection would light up the drop target.
    expect(hasDraggedFiles(transfer({ 'text/plain': 'just some selected words' }))).toBe(false);
    expect(hasDraggedFiles(transfer({ 'text/plain': 'see /repo/a.ts for details' }))).toBe(false);
    expect(hasDraggedFiles(transfer({}))).toBe(false);
    expect(hasDraggedFiles(null)).toBe(false);
  });

  test('the check is case-insensitive', () => {
    // Chrome lowercases the declared types; some hosts do not.
    expect(hasDraggedFiles(transfer({ Files: '' }))).toBe(true);
    expect(hasDraggedFiles(transfer({ DownloadURL: 'https://x/y.txt' }))).toBe(true);
  });
});

describe('collectDroppedFileUris', () => {
  test('reads a uri-list, skipping comments and blanks', () => {
    const dt = transfer({ 'text/uri-list': '# a comment\nfile:///repo/a.ts\n\nfile:///repo/b.ts' });
    expect(collectDroppedFileUris(dt)).toEqual(['file:///repo/a.ts', 'file:///repo/b.ts']);
  });

  test('prefers a file URL over the bare path on the same drag', () => {
    // macOS puts both on a Finder drag; one file must not become two entries.
    const dt = transfer({ 'text/uri-list': 'file:///repo/a.ts', 'text/plain': '/repo/a.ts' });
    expect(collectDroppedFileUris(dt)).toEqual(['file:///repo/a.ts']);
  });

  test('ignores a payload that is not a path or URL', () => {
    expect(collectDroppedFileUris(transfer({ 'text/plain': 'hello world' }))).toEqual([]);
    expect(collectDroppedFileUris(transfer({ 'text/plain': 'line one\nline two' }))).toEqual([]);
  });

  test('keeps a remote download URL', () => {
    expect(collectDroppedFileUris(transfer({ DownloadURL: 'https://x.example/f.txt' }))).toEqual(['https://x.example/f.txt']);
  });

  test('an unreadable data store yields nothing instead of throwing', () => {
    const dt = { getData: () => { throw new Error('not allowed during dragover'); } } as unknown as DataTransfer;
    expect(collectDroppedFileUris(dt)).toEqual([]);
  });
});

