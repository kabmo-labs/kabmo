/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a drop's payload: the two views of one dragged file, and the
 * server-side resolution of a reference that carries no bytes.
 *
 * The cases here are the ones that fail silently:
 *
 * - A drop can expose the SAME file twice — once in `dataTransfer.files`, once
 *   through the item list — and which of the two objects is readable is not
 *   knowable up front (a drop that reads in a browser tab has been seen to fail
 *   in an installed app window, with the failing object still reporting the
 *   right name and size). Both objects must survive as a pair to try.
 * - A directory's item entry is not a file to read; it is the tree the walk
 *   expands. Its `files` counterpart is a size-0, type-less stub.
 * - A dropped reference has three distinct refusal reasons, and the user can
 *   only act on the right one.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readDroppedEntries } from '@/client/hooks/chat/composer/drop-entries';
import {
  describeReferenceFailure,
  describeUnreadable,
  readDroppedReference,
  referenceName,
} from '@/client/hooks/chat/composer/drop-references';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'File', 'Blob'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. *//** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  if (nativeFetch) target.fetch = nativeFetch;
  else delete target.fetch;
});

afterEach(() => {
  if (nativeFetch) (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

/** A DataTransfer exposing the same item list shape the browser does. */
function transfer(
  items: { entry?: FileSystemEntry | null; file?: File | null }[],
  files: File[] = [],
): { dt: DataTransfer; getAsFileCalls: () => number } {
  let calls = 0;
  const dt = {
    items: items.map(({ entry = null, file = null }) => ({
      kind: 'file',
      webkitGetAsEntry: () => entry,
      getAsFile: () => { calls += 1; return file; },
    })),
    files,
  } as unknown as DataTransfer;
  return { dt, getAsFileCalls: () => calls };
}

function fileEntry(name: string): FileSystemFileEntry {
  return { isFile: true, isDirectory: false, name } as unknown as FileSystemFileEntry;
}

describe('readDroppedEntries', () => {
  test('pairs the two views of one file so a read can fall back to the other', () => {
    const fromFiles = new File(['bytes'], 'a.ts', { type: 'text/plain' });
    const fromItems = new File(['bytes'], 'a.ts', { type: 'text/plain' });
    const { dt } = transfer([{ entry: fileEntry('a.ts'), file: fromItems }], [fromFiles]);

    const entries = readDroppedEntries(dt);
    expect(entries.files).toEqual([fromFiles]);
    expect(entries.fallbacks.get(fromFiles)).toBe(fromItems);
    expect(entries.fallbacks.size).toBe(1);
  });

  test('does not pair files whose names differ — the name is all they share', () => {
    const fromFiles = new File(['bytes'], 'a.ts', { type: 'text/plain' });
    const other = new File(['bytes'], 'b.ts', { type: 'text/plain' });
    const { dt } = transfer([{ entry: fileEntry('b.ts'), file: other }], [fromFiles]);

    expect(readDroppedEntries(dt).fallbacks.size).toBe(0);
  });

  test('a directory item is collected for the walk and its file is never read', () => {
    const directory = { isFile: false, isDirectory: true, name: 'src' } as unknown as FileSystemDirectoryEntry;
    const { dt, getAsFileCalls } = transfer([{ entry: directory, file: new File(['x'], 'src', { type: '' }) }]);

    const entries = readDroppedEntries(dt);
    expect(entries.directories).toEqual([directory]);
    expect(entries.files).toEqual([]);
    // The entry is read first and in the same pass; consuming the item's other
    // view afterwards would lose one of the two.
    expect(getAsFileCalls()).toBe(0);
  });

  test('a size-0, type-less item stub is not a file to attach', () => {
    const { dt } = transfer([{ entry: null, file: new File([], 'from-a-page.txt', { type: '' }) }]);
    expect(readDroppedEntries(dt).files).toEqual([]);
  });

  test('an item file with no entry is taken as the primary when files is empty', () => {
    const fromItems = new File(['item body'], 'only-items.txt', { type: 'text/plain' });
    const { dt } = transfer([{ entry: null, file: fromItems }]);
    expect(readDroppedEntries(dt).files).toEqual([fromItems]);
  });

  test('an empty payload yields nothing at all', () => {
    const { dt } = transfer([]);
    expect(readDroppedEntries(dt)).toEqual({ files: [], directories: [], fallbacks: new Map() });
  });
});

/** A fetch stub answering one canned response, recording the URL it was asked for. */
function stubFetch(answer: { ok: boolean; status: number; body: unknown } | 'network-error'): { urls: string[] } {
  const urls: string[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = (async (input: unknown) => {
    urls.push(String(input));
    if (answer === 'network-error') throw new Error('offline');
    return { ok: answer.ok, status: answer.status, json: async () => answer.body };
  }) as unknown as typeof fetch;
  return { urls };
}

describe('readDroppedReference', () => {
  test('a readable reference becomes a text File named by the server', async () => {
    const { urls } = stubFetch({ ok: true, status: 200, body: { content: '# hello', name: 'notes.md' } });

    const result = await readDroppedReference('/repo/notes.md', '/repo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.name).toBe('notes.md');
    expect(result.file.type).toBe('text/plain');
    expect(await result.file.text()).toBe('# hello');
    // The root is a hint for a relative reference; the path always travels.
    expect(urls[0]).toBe('/api/fs/read-reference?path=%2Frepo%2Fnotes.md&root=%2Frepo');
  });

  test('an absolute reference with no workspace root sends no root hint', async () => {
    const { urls } = stubFetch({ ok: true, status: 200, body: { content: 'x' } });
    await readDroppedReference('https://x.example/f.txt', null);
    expect(urls[0]).toBe('/api/fs/read-reference?path=https%3A%2F%2Fx.example%2Ff.txt');
  });

  test('the server name wins, and the reference name is the fallback', async () => {
    stubFetch({ ok: true, status: 200, body: { content: 'x', name: '' } });
    const result = await readDroppedReference('file:///repo/sub/notes.md', null);
    expect(result.ok && result.file.name).toBe('notes.md');
  });

  test('each refusal carries the reason the user has to act on', async () => {
    stubFetch({ ok: false, status: 403, body: { error: 'remote downloads are not supported' } });
    expect(await readDroppedReference('https://x/y.png', null)).toEqual({ ok: false, reason: 'remote' });

    stubFetch({ ok: false, status: 415, body: { error: 'not an image or raw text' } });
    expect(await readDroppedReference('/repo/a.bin', null)).toEqual({ ok: false, reason: 'binary' });

    stubFetch({ ok: false, status: 404, body: { error: 'not found' } });
    expect(await readDroppedReference('/etc/passwd', null)).toEqual({ ok: false, reason: 'outside-roots' });

    stubFetch({ ok: false, status: 500, body: { error: 'boom' } });
    expect(await readDroppedReference('/repo/a.ts', null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a dropped connection and a bodyless 200 are both unavailable', async () => {
    stubFetch('network-error');
    expect(await readDroppedReference('/repo/a.ts', null)).toEqual({ ok: false, reason: 'unavailable' });

    stubFetch({ ok: true, status: 200, body: { content: 42 } });
    expect(await readDroppedReference('/repo/a.ts', null)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('referenceName', () => {
  test('takes the last path segment, decoded, with the query stripped', () => {
    expect(referenceName('https://x.example/a/my%20notes.md?token=1#frag')).toBe('my notes.md');
    expect(referenceName('/repo/sub/dir/')).toBe('dir');
    expect(referenceName('file:///repo/a.ts')).toBe('a.ts');
  });

  test('falls back to a generic name when there is no segment to take', () => {
    expect(referenceName('')).toBe('attachment');
    expect(referenceName('https://x.example')).toBe('x.example');
  });

  test('a malformed percent-escape keeps the raw segment instead of throwing', () => {
    expect(referenceName('/repo/%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('refusal messages', () => {
  test('name one file or count many', () => {
    expect(describeUnreadable(['a.md'])).toBe('"a.md" could not be read and was not attached.');
    expect(describeUnreadable(['a.md', 'b.md'])).toBe('2 files could not be read and were not attached: a.md, b.md.');
  });

  test('elide the list past three names but keep the count', () => {
    const many = ['a', 'b', 'c', 'd', 'e'];
    expect(describeUnreadable(many)).toBe('5 files could not be read and were not attached: a, b, c….');
    expect(describeReferenceFailure(many, 'binary')).toBe('5 files are not a text file and were not attached (a, b, c…).');
  });

  test('give each cause its own wording, singular or plural', () => {
    expect(describeReferenceFailure(['/repo/a.ts'], 'outside-roots'))
      .toBe('"/repo/a.ts" lies outside the folders Kabmo may read, so it was not attached (/repo/a.ts).');
    expect(describeReferenceFailure(['a', 'b'], 'outside-roots'))
      .toBe('2 files lie outside the folders Kabmo may read, so they were not attached (a, b).');
    expect(describeReferenceFailure(['x.txt'], 'remote'))
      .toBe('"x.txt" is a web download; save it into a workspace folder first (x.txt).');
    expect(describeReferenceFailure(['x.txt'], 'binary'))
      .toBe('"x.txt" is not a text file and was not attached (x.txt).');
    // An unknown cause degrades to the generic unreadable message.
    expect(describeReferenceFailure(['x.txt'], 'unavailable'))
      .toBe('"x.txt" could not be read and was not attached.');
  });
});
