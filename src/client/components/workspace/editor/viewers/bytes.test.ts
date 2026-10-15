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
import { PDF_MAX_FILE_BYTES } from '@/shared/lib/fs/file-kind';
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
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(3), json: async () => null };
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

  // A refusal body carries the reason ("This file is 21.00 MB — larger than the
  // 20.00 MB the editor opens.") and that sentence is the whole point of the
  // refusal. Reporting the status code instead would describe the transport
  // rather than the problem.
  test('a failed raw read reports the server reason, not just the status', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 415,
      json: async () => ({ error: 'This file is 21.00 MB — larger than the 20.00 MB the editor opens.' }),
    })) as unknown as typeof globalThis.fetch;
    const source = byteSourceFor({ path: 'big.docx', rawUrl: '/api/fs/raw?path=big.docx' });
    await expect(source.loadBytes?.()).rejects.toThrow('larger than the 20.00 MB');
    globalThis.fetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1), json: async () => null })) as unknown as typeof globalThis.fetch;
  });

  // A refusal with no readable body still has to say something: the status is
  // the fallback, never a bare throw with no message.
  test('a refusal with no body falls back to the status', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof globalThis.fetch;
    const source = byteSourceFor({ path: 'x.pdf', rawUrl: '/api/fs/raw?path=x.pdf' });
    await expect(source.loadBytes?.()).rejects.toThrow('404');
    globalThis.fetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1), json: async () => null })) as unknown as typeof globalThis.fetch;
  });

  // The trap this pins: a handle-backed tab carries a `path` that is only a
  // display name, so a raw URL built from it would fetch whatever file happens
  // to sit at that path in the default workspace.
  test('a handle-backed tab never gets a raw URL, even though it has a path', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    // The id is read from the event the open dispatches, never hardcoded: the
    // handle counter is module state shared across the whole test run, so which
    // id `openHandleAsTab` mints depends on how many files registered before it.
    let handleId: string | undefined;
    const capture = (event: Event) => {
      handleId = (event as CustomEvent<{ handleId?: string }>).detail?.handleId;
    };
    window.addEventListener('omp:open-file', capture);
    try {
      const result = await openHandleAsTab(fakeHandle('shot.png', bytes), 'drop');
      expect(result.ok).toBe(true);
      // No `content` for a picture: the viewer reads the bytes itself.
      expect(result.message).toContain('shot.png');
    } finally {
      window.removeEventListener('omp:open-file', capture);
    }
    if (!handleId) throw new Error('the open did not carry a handle id');

    // The editor's own source construction is what the hook does: a handle id
    // means no server path, so `rawUrl` is null and the handle is the source.
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

  // The MIME type is what makes a handle-backed PDF render at all: the object
  // URL the viewer builds serves its Blob's own `Content-Type`, and Chrome's
  // PDF plugin refuses to initialize on an empty one. A dropped `report.pdf`
  // used to be wrapped in `new Blob([bytes])` — no type — so the frame stayed
  // blank while a workspace PDF (whose URL is `/api/fs/raw`, which sets the
  // header) rendered fine.
  test('a handle-backed document carries its MIME type', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const handleId = await registerHandle('report.pdf', bytes);
    const source = byteSourceFor({ path: 'report.pdf', handleId, rawUrl: null });

    expect(source.url).toBeNull();
    expect(source.mimeType).toBe('application/pdf');
  });

  test('a workspace document carries the same MIME type its raw URL serves', () => {
    const source = byteSourceFor({ path: 'docs/report.pdf', rawUrl: '/api/fs/raw?path=docs%2Freport.pdf' });
    expect(source.mimeType).toBe('application/pdf');
  });

  // A text file has no byte-viewer MIME, and guessing one would be a lie the
  // Blob would then serve as its `Content-Type`.
  test('a kind with no byte-viewer MIME reports null, not a guess', () => {
    expect(byteSourceFor({ path: 'notes.txt', rawUrl: '/api/fs/raw?path=notes.txt' }).mimeType).toBeNull();
    expect(byteSourceFor({ path: undefined, handleId: undefined, rawUrl: null }).mimeType).toBeNull();
  });
});

/** Register a handle through the real open path and return the id it minted. */
async function registerHandle(name: string, bytes: Uint8Array): Promise<string> {
  let handleId: string | undefined;
  const capture = (event: Event) => {
    handleId = (event as CustomEvent<{ handleId?: string }>).detail?.handleId;
  };
  window.addEventListener('omp:open-file', capture);
  try {
    await openHandleAsTab(fakeHandle(name, bytes), 'drop');
  } finally {
    window.removeEventListener('omp:open-file', capture);
  }
  if (!handleId) throw new Error(`the open of ${name} did not carry a handle id`);
  return handleId;
}

/**
 * The DROP path end to end, which is where both defects met: `openHandleAsTab`
 * decides whether a dropped file becomes a tab at all, and the source it leaves
 * behind is what the viewer builds its object URL from.
 */
describe('a dropped PDF', () => {
  // The 5 MiB text ceiling used to refuse the tab outright, so a 6 MB PDF
  // dragged from Finder never reached a viewer — the reported "PDF gagal
  // render". Its bytes never enter the page, so the text ceiling is the wrong
  // number for it.
  test('past the text ceiling still opens', async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024).fill(0x25);
    let result: { ok: boolean; message: string } | undefined;
    const capture = (event: Event) => {
      const detail = (event as CustomEvent<{ handleId?: string }>).detail;
      const source = byteSourceFor({ path: 'big.pdf', handleId: detail?.handleId, rawUrl: null });
      result = { ok: source.mimeType === 'application/pdf', message: source.mimeType ?? '' };
    };
    window.addEventListener('omp:open-file', capture);
    try {
      const opened = await openHandleAsTab(fakeHandle('big.pdf', bytes), 'drop');
      expect(opened.ok).toBe(true);
    } finally {
      window.removeEventListener('omp:open-file', capture);
    }
    // The source the tab carries is usable by the viewer: a handle id and the
    // MIME type its object URL needs.
    expect(result?.ok).toBe(true);
  });

  test('past the PDF ceiling is refused with the 30 MB sentence', async () => {
    const bytes = new Uint8Array(PDF_MAX_FILE_BYTES + 1).fill(0x25);
    const opened = await openHandleAsTab(fakeHandle('huge.pdf', bytes), 'drop');

    expect(opened.ok).toBe(false);
    expect(opened.message).toContain('30.00 MB');
  });
});
