/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `resolveViewer` — the viewer a tab gets, and where its bytes come from.
 *
 * Every rule here fails SILENTLY when wrong, which is why they are pinned:
 *
 * 1. the viewer comes from the PATH alone, so the pane, the toolbar and the
 *    phone's editor cannot disagree about which file has a rendered form;
 * 2. a handle-backed tab has no server path — its `path` is only a display name
 *    — so a raw URL built from it would fetch an unrelated file;
 * 3. an image keeps its own `imageUrl` field (the image viewer and the transfer
 *    path read it) while every other byte viewer takes the source object.
 *
 * The revision cache-bust is the fourth: an image's URL carries `&v=` so a
 * refresh re-decodes the picture, and the other byte viewers key their re-read
 * on `revision` directly rather than on the URL.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { resolveViewer as ResolveViewer } from '@/client/hooks/editor/resolve-viewer';
import type { openHandleAsTab as OpenHandleAsTab } from '@/client/lib/launch/file-handlers';

let resolveViewer: typeof ResolveViewer;
let openHandleAsTab: typeof OpenHandleAsTab;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ resolveViewer } = await import('@/client/hooks/editor/resolve-viewer'));
  ({ openHandleAsTab } = await import('@/client/lib/launch/file-handlers'));
});

afterAll(() => {
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
      slice: (start: number, end?: number) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }),
      arrayBuffer: async () => bytes.buffer,
      text: async () => new TextDecoder().decode(bytes),
    }),
  } as unknown as FileSystemFileHandle;
}

describe('resolveViewer', () => {
  test('the viewer comes from the path', () => {
    expect(resolveViewer({ path: 'notes.md' }, 0).viewerKind).toBe('markdown');
    expect(resolveViewer({ path: 'report.pdf' }, 0).viewerKind).toBe('pdf');
    expect(resolveViewer({ path: 'sheet.xlsx' }, 0).viewerKind).toBe('spreadsheet');
    expect(resolveViewer({ path: 'data.csv' }, 0).viewerKind).toBe('csv');
    expect(resolveViewer({ path: 'logo.svg' }, 0).viewerKind).toBe('svg');
    expect(resolveViewer({ path: 'src/app.ts' }, 0).viewerKind).toBe('code');
    expect(resolveViewer(null, 0).viewerKind).toBe('code');
  });

  test('a byte viewer is marked binary; a text viewer is not', () => {
    for (const path of ['report.pdf', 'brief.docx', 'book.xlsx', 'pic.png']) {
      expect(resolveViewer({ path }, 0).isBinaryViewer).toBe(true);
    }
    // CSV and SVG read the TEXT buffer, so neither is a byte viewer.
    for (const path of ['data.csv', 'logo.svg', 'notes.md', 'src/app.ts']) {
      expect(resolveViewer({ path }, 0).isBinaryViewer).toBe(false);
    }
  });

  test('a workspace image gets its raw URL, cache-busted per revision', () => {
    const resolved = resolveViewer({ path: 'pic.png', root: '/ws', repo: 'projects/token' }, 7);
    expect(resolved.isImage).toBe(true);
    expect(resolved.imageUrl).toBe(resolved.byteSource.url);
    expect(resolved.imageUrl).toContain('/api/fs/raw');
    expect(resolved.imageUrl).toContain('path=pic.png');
    expect(resolved.imageUrl).toContain('root=%2Fws');
    expect(resolved.imageUrl).toContain('repo=projects%2Ftoken');
    // The revision is what re-decodes the picture on a refresh.
    expect(resolved.imageUrl).toContain('&v=7');
    expect(resolveViewer({ path: 'pic.png', root: '/ws' }, 8).imageUrl).toContain('&v=8');
  });

  test('a handle-backed tab never gets a raw URL, even though it carries a path', async () => {
    // A real registration, because that is what puts the handle in the registry
    // `byteSourceFor` reads — a made-up id would prove nothing about the source.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    // The id is read from the event the open actually dispatches, never
    // hardcoded: the handle counter is module state shared with every other
    // suite in the run, so `drop-0` belongs to whichever file registered first.
    let handleId: string | undefined;
    const capture = (event: Event) => {
      handleId = (event as CustomEvent<{ handleId?: string }>).detail?.handleId;
    };
    window.addEventListener('omp:open-file', capture);
    try {
      const opened = await openHandleAsTab(fakeHandle('dropped.png', bytes), 'drop');
      expect(opened.ok).toBe(true);
    } finally {
      window.removeEventListener('omp:open-file', capture);
    }
    if (!handleId) throw new Error('the open did not carry a handle id');

    const resolved = resolveViewer({ path: 'dropped.png', handleId }, 0);
    // No server path → no raw URL, and the picture is drawn from the handle.
    expect(resolved.byteSource.url).toBeNull();
    expect(resolved.imageUrl).toBeNull();
    // `isImage` is the workspace-path branch; a handle-backed picture takes the
    // generic byte-viewer branch and reads its bytes through the handle.
    expect(resolved.isImage).toBe(false);
    expect(resolved.viewerKind).toBe('image');
    expect(resolved.byteSource.id).toBe(handleId);
    expect(resolved.byteSource.loadBytes).not.toBeNull();
    // And the bytes really come back through it.
    const read = new Uint8Array(await resolved.byteSource.loadBytes!());
    expect(read.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  test('an inline attachment (content, no path) has no byte source', () => {
    const resolved = resolveViewer({ path: 'pic.png', content: 'not-a-path' }, 0);
    expect(resolved.isImage).toBe(false);
    expect(resolved.imageUrl).toBeNull();
    expect(resolved.byteSource.url).toBeNull();
  });

  test('a document viewer takes the source object, not an imageUrl', () => {
    const resolved = resolveViewer({ path: 'report.pdf', root: '/ws' }, 3);
    expect(resolved.isImage).toBe(false);
    expect(resolved.imageUrl).toBeNull();
    expect(resolved.byteSource.url).toContain('/api/fs/raw');
    expect(resolved.byteSource.url).toContain('path=report.pdf');
    // No cache-bust on a non-image byte viewer: it re-reads on `revision`.
    expect(resolved.byteSource.url).not.toContain('&v=');
  });
});
