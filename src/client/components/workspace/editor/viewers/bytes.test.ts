/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `byteSourceFor` — where a byte viewer's bytes come from.
 *
 * Two claims, and each is a way a file is read from the WRONG place:
 *
 * - a workspace path resolves through `/api/fs/raw`, carrying the same scope
 *   (`root`, nested `repo`) the read route uses;
 * - a handle-backed tab (a drop, a launch) never builds a raw URL at all, even
 *   though it carries a `path` — that path is only a display name, and a URL
 *   built from it would fetch an unrelated file.
 *
 * Plus the identity rule the viewer effects depend on: `id` changes only when
 * the file does, because a fresh `loadBytes` closure on every render would
 * re-parse the document on every render.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { byteSourceFor as ByteSourceFor } from '@/client/components/workspace/editor/viewers/bytes';
import type { openHandleAsTab as OpenHandleAsTab } from '@/client/lib/launch/file-handlers';

let byteSourceFor: typeof ByteSourceFor;
let openHandleAsTab: typeof OpenHandleAsTab;
const fetched: string[] = [];
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  ({ byteSourceFor } = await import('@/client/components/workspace/editor/viewers/bytes'));
  ({ openHandleAsTab } = await import('@/client/lib/launch/file-handlers'));
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(3) };
  }) as unknown as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

/** A handle over some bytes, as a drop or a launch produces. */
function fakeHandle(name: string, bytes: Uint8Array): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => ({
      name,
      size: bytes.byteLength,
      slice: (start: number, end?: number) => ({
        arrayBuffer: async () => bytes.slice(start, end).buffer,
      }),
      arrayBuffer: async () => bytes.buffer,
      text: async () => new TextDecoder().decode(bytes),
    }),
  } as unknown as FileSystemFileHandle;
}

describe('byteSourceFor', () => {
  test('a workspace path reads through /api/fs/raw with its scope', async () => {
    const source = byteSourceFor({
      path: 'docs/report.pdf',
      rawUrl: '/api/fs/raw?path=docs%2Freport.pdf&root=%2Fws&repo=sub',
    });

    expect(source.url).toBe('/api/fs/raw?path=docs%2Freport.pdf&root=%2Fws&repo=sub');
    expect(source.id).toBe(source.url ?? '');
    fetched.length = 0;
    await source.loadBytes?.();
    expect(fetched[0]).toContain('/api/fs/raw');
  });

  test('a failed raw read reports the status, not an empty buffer', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof globalThis.fetch;
    const source = byteSourceFor({ path: 'x.pdf', rawUrl: '/api/fs/raw?path=x.pdf' });
    await expect(source.loadBytes?.()).rejects.toThrow('404');
    globalThis.fetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) })) as unknown as typeof globalThis.fetch;
  });

  // The trap this pins: a handle-backed tab carries a `path` that is only a
  // display name, so a raw URL built from it would fetch whatever file happens
  // to sit at that path in the default workspace.
  test('a handle-backed tab never gets a raw URL, even though it has a path', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await openHandleAsTab(fakeHandle('shot.png', bytes), 'drop');
    expect(result.ok).toBe(true);
    // No `content` for a picture: the viewer reads the bytes itself.
    expect(result.message).toContain('shot.png');

    // The editor's own source construction is what the hook does: a handle id
    // means no server path, so `rawUrl` is null and the handle is the source.
    const handleId = 'drop-0';
    const source = byteSourceFor({ path: 'shot.png', handleId, rawUrl: null });
    expect(source.url).toBeNull();
    expect(source.id).toBe(handleId);
    expect(source.loadBytes).not.toBeNull();
  });

  test('a target with neither a path nor a handle has no source at all', () => {
    const source = byteSourceFor({ path: undefined, handleId: undefined, rawUrl: null });
    expect(source.url).toBeNull();
    expect(source.loadBytes).toBeNull();
    expect(source.id).toBe('');
  });

  // The effects key on `id`; a fresh closure with the same id must not look like
  // a different file, or every render would re-parse the document.
  test('the id is stable across two calls for the same URL', () => {
    const a = byteSourceFor({ path: 'x.pdf', rawUrl: '/api/fs/raw?path=x.pdf' });
    const b = byteSourceFor({ path: 'x.pdf', rawUrl: '/api/fs/raw?path=x.pdf' });
    expect(a.id).toBe(b.id);
    expect(a.loadBytes).not.toBe(b.loadBytes);
  });
});
