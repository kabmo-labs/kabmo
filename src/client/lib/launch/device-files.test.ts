/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A document a PHONE handed over, delivered as bytes.
 *
 * The rules under test are the ones that fail silently on a device: a truncated
 * transfer that opens as a corrupt document, two files of one name colliding,
 * and a text file whose bytes are pushed into a tab that then tries to SAVE it
 * to a path the console cannot reach.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  DEVICE_CHUNK_PROPERTY,
  DEVICE_FILES_PROPERTY,
  decodeBase64,
  deviceFileFor,
  installDeviceFiles,
} from '@/client/lib/launch/device-files';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'CustomEvent', 'atob'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let opened: { path?: string; name?: string; content?: string; handleId?: string; deviceFile?: boolean }[] = [];
let reported: { name: string; ok: boolean; message: string }[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    // `atob` is a Bun global too, so it is borrowed from the window like the
    // rest — the module calls it on the decode path.
    target[key] = key === 'atob' ? (win as unknown as Record<string, unknown>)[key] ?? target[key] : (win as unknown as Record<string, unknown>)[key];
  }
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent).detail);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

beforeEach(() => {
  opened = [];
  reported = [];
  installDeviceFiles({ onResult: (results) => reported.push(...results) });
});

/** What a shell does: announce, then stream the file in `chunk`-byte pieces. */
function deliver(meta: { id: string; name: string; mimeType?: string }, text: string, chunk = 4) {
  const host = globalThis.window as unknown as Record<string, unknown>;
  const announce = host[DEVICE_FILES_PROPERTY] as (metas: unknown) => void;
  const push = host[DEVICE_CHUNK_PROPERTY] as (id: string, base64: string, last: boolean) => void;
  announce([meta]);
  const bytes = new TextEncoder().encode(text);
  const base64 = btoa(String.fromCharCode(...bytes));
  const pieces: string[] = [];
  for (let index = 0; index < base64.length; index += chunk) pieces.push(base64.slice(index, index + chunk));
  pieces.forEach((piece, index) => push(meta.id, piece, index === pieces.length - 1));
}

describe('decodeBase64', () => {
  test('decodes to the same bytes the shell encoded', () => {
    const text = 'hello, kabmo';
    const bytes = decodeBase64(btoa(text));
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  test('an empty string decodes to nothing rather than throwing', () => {
    expect(decodeBase64('').byteLength).toBe(0);
  });
});

describe('installDeviceFiles', () => {
  test('a delivered text file opens a tab with its content, marked device-backed', () => {
    deliver({ id: 'dev-1', name: 'notes.md' }, '# hi\n');

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ path: 'notes.md', name: 'notes.md', content: '# hi\n', handleId: 'dev-1', deviceFile: true });
    // The bytes stay registered: the tab's byte source reads them for a viewer
    // (a document, a picture), and the map is the only copy.
    expect(deviceFileFor('dev-1')?.bytes.byteLength).toBe(5);
    expect(reported.at(-1)).toMatchObject({ name: 'notes.md', ok: true });
  });

  test('the file is assembled from every chunk, not only the last', () => {
    // 4-byte chunks over a 24-byte base64 payload: a handler that kept only the
    // final piece would open a file whose content is the last 3 characters.
    deliver({ id: 'dev-2', name: 'a.txt' }, 'abcdefghijklmnop', 4);
    expect(opened[0]?.content).toBe('abcdefghijklmnop');
  });

  test('a binary file is refused with the shared sentence, and registers nothing', () => {
    // A NUL in the head is git's own binary test, and the classification is the
    // one the drop path and the read route use.
    const host = globalThis.window as unknown as Record<string, unknown>;
    (host[DEVICE_FILES_PROPERTY] as (metas: unknown) => void)([{ id: 'dev-3', name: 'blob.bin' }]);
    const base64 = btoa(String.fromCharCode(0, 1, 2, 3));
    (host[DEVICE_CHUNK_PROPERTY] as (id: string, b64: string, last: boolean) => void)('dev-3', base64, true);

    expect(opened).toHaveLength(0);
    expect(deviceFileFor('dev-3')).toBeNull();
    expect(reported.at(-1)?.ok).toBe(false);
    expect(reported.at(-1)?.message).toContain('not text');
  });

  test('an incomplete transfer is reported instead of opening half a file', () => {
    const host = globalThis.window as unknown as Record<string, unknown>;
    (host[DEVICE_FILES_PROPERTY] as (metas: unknown) => void)([{ id: 'dev-4', name: 'broken.pdf' }]);
    // `last: false` forever — the shell died mid-transfer.
    (host[DEVICE_CHUNK_PROPERTY] as (id: string, b64: string, last: boolean) => void)('dev-4', 'JVBERi0x', false);

    expect(opened).toHaveLength(0);
    expect(reported).toHaveLength(0);
    // …and a chunk for an id nobody announced is ignored rather than creating a
    // tab with no name.
    (host[DEVICE_CHUNK_PROPERTY] as (id: string, b64: string, last: boolean) => void)('dev-unknown', 'AAAA', true);
    expect(opened).toHaveLength(0);
  });

  test('two deliveries of one name are two tabs, keyed by id', () => {
    deliver({ id: 'dev-5', name: 'report.md' }, 'first');
    deliver({ id: 'dev-6', name: 'report.md' }, 'second');

    expect(opened).toHaveLength(2);
    expect(deviceFileFor('dev-5') && new TextDecoder().decode(deviceFileFor('dev-5')!.bytes)).toBe('first');
    expect(deviceFileFor('dev-6') && new TextDecoder().decode(deviceFileFor('dev-6')!.bytes)).toBe('second');
  });

  test('a re-announced id restarts the transfer instead of appending to it', () => {
    const host = globalThis.window as unknown as Record<string, unknown>;
    const announce = host[DEVICE_FILES_PROPERTY] as (metas: unknown) => void;
    const push = host[DEVICE_CHUNK_PROPERTY] as (id: string, b64: string, last: boolean) => void;
    announce([{ id: 'dev-7', name: 'a.txt' }]);
    push('dev-7', btoa('old'), false);
    // The shell abandoned that delivery and started again.
    announce([{ id: 'dev-7', name: 'a.txt' }]);
    push('dev-7', btoa('new'), true);

    expect(opened[0]?.content).toBe('new');
  });

  test('a malformed announcement is ignored', () => {
    const host = globalThis.window as unknown as Record<string, unknown>;
    const announce = host[DEVICE_FILES_PROPERTY] as (metas: unknown) => void;
    announce('not an array');
    announce([{ name: 'no-id.txt' }, { id: 'no-name' }, null]);
    expect(opened).toHaveLength(0);
  });
});
